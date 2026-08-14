/**
 * Handler del scheduler para el monitoreo de servidores (tick por minuto).
 *
 * Hace tres cosas, cada una con su propia cadencia:
 *  1. **Caídas** (cada tick): un servidor con agente que no reporta en N minutos pasa a
 *     `offline` y abre incidente. Es la contracara del heartbeat: el reporte del agente dice
 *     "estoy vivo"; su ausencia dice "me caí". Detecta también un servidor colgado, que
 *     responde al ping pero no ejecuta nada.
 *  2. **Chequeo externo** (cada 5 min): a los servidores de terceros (`monitorea = false`)
 *     no les instalamos agente, así que se prueba abrir una conexión TCP a su puerto.
 *  3. **Resumen diario + purga** (una vez por día): consolida el detalle del día anterior en
 *     `servidor_metricas_dia` y borra el detalle de más de 30 días.
 *
 * Todo corre dentro del proceso del backend (servicio systemd), así que sigue funcionando
 * aunque nadie tenga la app abierta.
 */

import net from 'net';
import { Op } from 'sequelize';
import { getAppConfigNumber } from '../../../kernel/index.js';
import { abrirIncidente, resolverIncidente } from './alerta.service.js';

/** Cada cuánto se chequean por TCP los servidores de terceros. */
const MINUTOS_CHEQUEO_EXTERNO = 5;
/** Días de detalle fino que se conservan antes de purgar (queda el resumen diario). */
const DIAS_DETALLE = 30;
/**
 * Marca de la última consolidación diaria. Va directo contra `Config` (como los avisos
 * diarios y el GC) y NO por `getAppConfig`: ese servicio solo acepta las claves declaradas
 * en APP_CONFIG_KEYS, que son las CONFIGURABLES por el usuario. Esta es interna.
 */
const CONFIG_ROLLUP = 'MANTENIMIENTO_ULTIMO_ROLLUP';
/** Timeout del chequeo TCP: si no abre en 5s, se considera caído. */
const TIMEOUT_TCP_MS = 5000;

/**
 * ¿Responde el host en ese puerto? Prueba abrir un socket TCP y corta enseguida.
 * @param {string} host - IP o hostname.
 * @param {number} puerto - Puerto a probar.
 * @returns {Promise<boolean>} true si la conexión abrió.
 */
const respondeTcp = (host, puerto) => new Promise((resolve) => {
    const socket = new net.Socket();
    let resuelto = false;
    /**
     * Cierra el socket y resuelve una sola vez.
     * @param {boolean} ok - Resultado.
     * @returns {void}
     */
    const terminar = (ok) => {
        if (resuelto) return;
        resuelto = true;
        socket.destroy();
        resolve(ok);
    };
    socket.setTimeout(TIMEOUT_TCP_MS);
    socket.once('connect', () => terminar(true));
    socket.once('timeout', () => terminar(false));
    socket.once('error', () => terminar(false));
    socket.connect(puerto, host);
});

/**
 * Marca como caídos los servidores con agente que dejaron de reportar.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @returns {Promise<void>}
 */
const detectarCaidas = async (models, io) => {
    const { Servidor } = models;
    const minutos = await getAppConfigNumber(models, 'MANTENIMIENTO_MINUTOS_SIN_REPORTE');
    const limite = new Date(Date.now() - minutos * 60 * 1000);

    const candidatos = await Servidor.findAll({
        where: {
            activo: true,
            monitorea: true,
            estado: { [Op.ne]: 'offline' },
            // Sin contacto nunca (agente recién instalado que no arrancó) o contacto viejo.
            [Op.or]: [{ ultimoContactoAt: null }, { ultimoContactoAt: { [Op.lt]: limite } }],
        },
    });

    for (const servidor of candidatos) {
        // Un servidor que nunca reportó queda en 'desconocido': no se alerta por algo que
        // todavía no se instaló. Solo alerta el que reportaba y dejó de hacerlo.
        if (!servidor.ultimoContactoAt) continue;

        // Chequeo externo de corroboración: el silencio del agente solo dice que el agente
        // no habla. Probando el puerto desde afuera se distingue el servidor caído (no abre)
        // del agente muerto (el servidor responde) — dos problemas distintos, dos avisos
        // distintos. Son pocos servidores y solo los que ya están en silencio: es barato.
        const responde = await respondeTcp(servidor.ip, servidor.puertoChequeo);

        await servidor.update({ estado: 'offline' });
        await abrirIncidente(models, io, servidor, {
            tipo: 'offline',
            detalle: responde
                ? `El servidor responde en el puerto ${servidor.puertoChequeo}, pero el agente no reporta hace más de ${minutos} minuto(s): puede estar detenido el servicio del agente.`
                : `Sin reporte del agente hace más de ${minutos} minuto(s) y tampoco responde en el puerto ${servidor.puertoChequeo}.`,
        });
    }
};

/**
 * Chequea por TCP los servidores que no administramos (sin agente).
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @returns {Promise<void>}
 */
const chequearExternos = async (models, io) => {
    const { Servidor } = models;
    const servidores = await Servidor.findAll({ where: { activo: true, monitorea: false } });

    for (const servidor of servidores) {
        const ok = await respondeTcp(servidor.ip, servidor.puertoChequeo);
        if (ok) {
            await servidor.update({ estado: 'online', ultimoContactoAt: new Date() });
            await resolverIncidente(models, io, servidor, 'offline');
        } else if (servidor.estado !== 'offline') {
            await servidor.update({ estado: 'offline' });
            await abrirIncidente(models, io, servidor, {
                tipo: 'offline',
                detalle: `No responde en el puerto ${servidor.puertoChequeo}.`,
            });
        }
    }
};

/**
 * Consolida el detalle del día anterior en el resumen diario y purga lo viejo.
 * @param {object} models - Modelos de la app.
 * @returns {Promise<void>}
 */
const consolidarYPurgar = async (models) => {
    const { ServidorMetrica, ServidorMetricaDia, Config } = models;
    const hoy = new Date().toISOString().slice(0, 10);

    const marca = await Config.findOne({ where: { name: CONFIG_ROLLUP } });
    if (marca?.value === hoy) return; // ya se consolidó hoy

    // Resumen por servidor y día de TODO lo que todavía no esté resumido.
    const filas = await ServidorMetrica.findAll({
        attributes: [
            'servidorId',
            [ServidorMetrica.sequelize.fn('DATE', ServidorMetrica.sequelize.col('createdAt')), 'fecha'],
            [ServidorMetrica.sequelize.fn('AVG', ServidorMetrica.sequelize.col('cpu')), 'cpuProm'],
            [ServidorMetrica.sequelize.fn('MAX', ServidorMetrica.sequelize.col('cpu')), 'cpuMax'],
            [ServidorMetrica.sequelize.fn('AVG', ServidorMetrica.sequelize.col('ram')), 'ramProm'],
            [ServidorMetrica.sequelize.fn('MAX', ServidorMetrica.sequelize.col('ram')), 'ramMax'],
            [ServidorMetrica.sequelize.fn('AVG', ServidorMetrica.sequelize.col('disco')), 'discoProm'],
            [ServidorMetrica.sequelize.fn('MAX', ServidorMetrica.sequelize.col('disco')), 'discoMax'],
            [ServidorMetrica.sequelize.fn('COUNT', ServidorMetrica.sequelize.col('id')), 'muestras'],
        ],
        where: ServidorMetrica.sequelize.literal('DATE(`createdAt`) < CURDATE()'),
        group: ['servidorId', ServidorMetrica.sequelize.fn('DATE', ServidorMetrica.sequelize.col('createdAt'))],
        raw: true,
    });

    for (const f of filas) {
        const redondo = (v) => Math.round(Number(v) * 100) / 100;
        await ServidorMetricaDia.upsert({
            servidorId: f.servidorId,
            fecha: f.fecha,
            cpuProm: redondo(f.cpuProm), cpuMax: redondo(f.cpuMax),
            ramProm: redondo(f.ramProm), ramMax: redondo(f.ramMax),
            discoProm: redondo(f.discoProm), discoMax: redondo(f.discoMax),
            muestras: Number(f.muestras),
        });
    }

    // Purga del detalle: el resumen ya está guardado, así que no se pierde la tendencia.
    const corte = new Date(Date.now() - DIAS_DETALLE * 24 * 3600 * 1000);
    const borradas = await ServidorMetrica.destroy({ where: { createdAt: { [Op.lt]: corte } } });

    if (marca) await marca.update({ value: hoy });
    else await Config.create({ name: CONFIG_ROLLUP, value: hoy, description: 'Última consolidación diaria de métricas de servidores (interno).' });

    console.log(`📊 [MONITOREO] Resumen diario: ${filas.length} día(s) consolidado(s), ${borradas} muestra(s) purgada(s)`);
};

/** Minuto de la última corrida del chequeo externo (para espaciarlo del tick). */
let ultimoChequeoExterno = 0;

/**
 * Handler del scheduler: monitoreo de servidores.
 * @type {{name: string, run: (ctx: {models: object, io: object}) => Promise<void>}}
 */
export const monitoreoHandler = {
    name: 'monitoreo-servidores',
    /**
     * Corre en cada tick del scheduler (1 minuto).
     * @param {{models: object, io: object}} ctx - Contexto del scheduler.
     * @returns {Promise<void>}
     */
    run: async ({ models, io }) => {
        if (!models.Servidor) return; // módulo no montado

        await detectarCaidas(models, io);

        const ahora = Date.now();
        if (ahora - ultimoChequeoExterno >= MINUTOS_CHEQUEO_EXTERNO * 60 * 1000) {
            ultimoChequeoExterno = ahora;
            await chequearExternos(models, io);
        }

        await consolidarYPurgar(models);
    },
};
