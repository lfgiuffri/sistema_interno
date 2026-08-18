/**
 * Handler del scheduler para los sitios web (tick por minuto, trabajo cada 5).
 *
 *  1. **Disponibilidad** (cada 5 min): descarga cada sitio activo y busca el marcador del
 *     footer. La alerta espera al SEGUNDO fallo seguido (10 minutos) para no avisar por un
 *     microcorte de red; la recuperación, en cambio, avisa enseguida.
 *  2. **Certificado TLS**: se lee en el mismo chequeo (viene del handshake, sin costo extra).
 *  3. **Dominios** (una vez por día): refresco por RDAP y aviso de próximos a vencer.
 *  4. **Purga** (una vez por día): chequeos de más de 30 días.
 *
 * Corre dentro del proceso del backend, así que sigue activo aunque nadie use la app.
 */

import { Op } from 'sequelize';
import { getAppConfigNumber } from '../../../kernel/index.js';
import { avisar } from './alerta.service.js';
import { chequearSitio } from './chequeo.service.js';
import { vencimientoDominio } from './rdap.service.js';
import { estadoVencimiento } from './sitio.service.js';

/** Cada cuánto se chequea la disponibilidad. */
const MINUTOS_CHEQUEO = 5;
/** Días de historial de chequeos que se conservan. */
const DIAS_HISTORIAL = 30;
/** Marca de la última corrida diaria (dominios + purga). */
const CONFIG_DIARIO = 'MANTENIMIENTO_SITIOS_ULTIMO_DIARIO';
/** Capability cuyos titulares reciben las alertas de sitios. */
const CAPABILITY = 'sitios:read';

/** Etiquetas legibles por tipo de incidente. */
const TITULOS = {
    offline: (s) => `🔴 ${s.nombre} está caído`,
    sin_marcador: (s) => `⚠️ ${s.nombre} responde pero no es nuestro sitio`,
    dominio: (s) => `📅 Dominio de ${s.nombre} por vencer`,
    tls: (s) => `🔒 Certificado de ${s.nombre} por vencer`,
};

/**
 * Abre un incidente del sitio si no había uno abierto de ese tipo, y avisa una sola vez.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @param {object} sitio - Sitio afectado.
 * @param {string} tipo - Tipo de incidente.
 * @param {string} detalle - Texto del problema.
 * @returns {Promise<boolean>} true si abrió y avisó.
 */
const abrir = async (models, io, sitio, tipo, detalle) => {
    const { SitioIncidente } = models;
    const abierto = await SitioIncidente.findOne({ where: { sitioId: sitio.id, tipo, resueltoAt: null } });
    if (abierto) return false;

    await SitioIncidente.create({ sitioId: sitio.id, tipo, detalle: detalle?.slice(0, 255) ?? null, createdAt: new Date() });
    await avisar(models, io, {
        tipo: `sitio-${tipo}`,
        titulo: (TITULOS[tipo] ?? ((s) => `Alerta en ${s.nombre}`))(sitio),
        cuerpo: `${sitio.url} — ${detalle}`,
        url: `/mantenimiento/sitios`,
    }, CAPABILITY);
    return true;
};

/**
 * Cierra el incidente abierto de ese tipo (si hay) y avisa la recuperación.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @param {object} sitio - Sitio.
 * @param {string} tipo - Tipo de incidente.
 * @param {boolean} [avisarRecuperacion] - Si manda el aviso (los vencimientos no lo necesitan).
 * @returns {Promise<boolean>} true si había uno abierto.
 */
const cerrar = async (models, io, sitio, tipo, avisarRecuperacion = true) => {
    const { SitioIncidente } = models;
    const abierto = await SitioIncidente.findOne({ where: { sitioId: sitio.id, tipo, resueltoAt: null } });
    if (!abierto) return false;

    const ahora = new Date();
    await abierto.update({ resueltoAt: ahora });
    if (!avisarRecuperacion) return true;

    const minutos = Math.max(1, Math.round((ahora - new Date(abierto.createdAt)) / 60000));
    await avisar(models, io, {
        tipo: 'sitio-ok',
        titulo: `✅ ${sitio.nombre} volvió a estar en línea`,
        cuerpo: `${sitio.url} — estuvo con problemas ${minutos} minuto(s).`,
        url: '/mantenimiento/sitios',
    }, CAPABILITY);
    return true;
};

/**
 * Chequea todos los sitios activos y actualiza su estado.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @returns {Promise<void>}
 */
const chequearSitios = async (models, io) => {
    const { SitioWeb, SitioChequeo } = models;
    const sitios = await SitioWeb.findAll({ where: { activo: true } });
    const minimoFallos = await getAppConfigNumber(models, 'MANTENIMIENTO_FALLOS_PARA_ALERTA');
    const diasTls = await getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_TLS');

    for (const sitio of sitios) {
        const r = await chequearSitio(sitio.url, sitio.verificaMarcador);

        await SitioChequeo.create({
            sitioId: sitio.id,
            estado: r.estado,
            httpStatus: r.httpStatus,
            tiempoMs: r.tiempoMs,
            motivo: r.motivo?.slice(0, 200) ?? null,
            createdAt: new Date(),
        });

        const fallo = r.estado !== 'online';
        const fallosSeguidos = fallo ? sitio.fallosSeguidos + 1 : 0;

        await sitio.update({
            estado: r.estado,
            ultimoChequeoAt: new Date(),
            ultimoCodigo: r.httpStatus,
            tiempoMs: r.tiempoMs,
            fallosSeguidos,
            // El TLS solo se pisa si se pudo leer: un error de red no debe borrar la fecha.
            ...(r.tlsVenceAt ? { tlsVenceAt: r.tlsVenceAt } : {}),
        });

        // Alerta recién al N-ésimo fallo consecutivo (default 2 = 10 minutos).
        if (fallo && fallosSeguidos >= minimoFallos) {
            await abrir(models, io, sitio, r.estado === 'offline' ? 'offline' : 'sin_marcador', r.motivo ?? 'Sin detalle');
        }
        if (!fallo) {
            await cerrar(models, io, sitio, 'offline');
            await cerrar(models, io, sitio, 'sin_marcador');
        }

        // Certificado por vencer: se evalúa con la fecha recién leída.
        const tls = estadoVencimiento(sitio.tlsVenceAt, diasTls);
        if (tls.estado === 'por_vencer' || tls.estado === 'vencido') {
            await abrir(models, io, sitio, 'tls', tls.estado === 'vencido'
                ? `El certificado venció el ${sitio.tlsVenceAt}.`
                : `El certificado vence el ${sitio.tlsVenceAt} (en ${tls.dias} días).`);
        } else if (tls.estado === 'ok') {
            await cerrar(models, io, sitio, 'tls', false);
        }
    }
};

/**
 * Refresca los vencimientos de dominio por RDAP y avisa los que están por vencer.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @returns {Promise<void>}
 */
const revisarDominios = async (models, io) => {
    const { SitioWeb } = models;
    const sitios = await SitioWeb.findAll({ where: { activo: true } });
    const diasAviso = await getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_DOMINIO');

    for (const sitio of sitios) {
        // RDAP no pisa una fecha cargada A MANO. Ojo con la condición: `dominioAuto = false`
        // significa dos cosas distintas —«la puso una persona» y «todavía nunca se consultó»—
        // y solo la primera debe frenar el refresco. Distinguirlas por la fecha: sin fecha,
        // no hay nada que respetar. (Antes se miraba solo `dominioAuto` y un sitio nuevo, que
        // nace en false, no se consultaba NUNCA.)
        const fechaManual = !!sitio.dominioVenceAt && sitio.dominioAuto === false;
        if (sitio.dominio && !fechaManual) {
            const r = await vencimientoDominio(sitio.dominio);
            if (r.ok && r.venceAt) {
                // Se guarda el dominio REGISTRABLE que resolvió RDAP: es el que vence.
                await sitio.update({ dominio: r.dominio, dominioVenceAt: r.venceAt, dominioAuto: true, dominioConsultadoAt: new Date() });
            } else {
                // Falla de RDAP o TLD sin soporte: se deja la fecha que hubiera (no se borra).
                await sitio.update({ dominioConsultadoAt: new Date() });
            }
        }

        const dom = estadoVencimiento(sitio.dominioVenceAt, diasAviso);
        if (dom.estado === 'por_vencer' || dom.estado === 'vencido') {
            await abrir(models, io, sitio, 'dominio', dom.estado === 'vencido'
                ? `El dominio ${sitio.dominio} venció el ${sitio.dominioVenceAt}.`
                : `El dominio ${sitio.dominio} vence el ${sitio.dominioVenceAt} (en ${dom.dias} días).`);
        } else if (dom.estado === 'ok') {
            await cerrar(models, io, sitio, 'dominio', false);
        }
    }
};

/** Momento del último chequeo de disponibilidad. */
let ultimoChequeo = 0;

/**
 * Handler del scheduler: monitoreo de sitios web.
 * @type {{name: string, run: (ctx: {models: object, io: object}) => Promise<void>}}
 */
export const sitiosHandler = {
    name: 'monitoreo-sitios',
    /**
     * Corre en cada tick del scheduler (1 minuto) pero trabaja cada 5.
     * @param {{models: object, io: object}} ctx - Contexto del scheduler.
     * @returns {Promise<void>}
     */
    run: async ({ models, io }) => {
        if (!models.SitioWeb) return; // módulo no montado

        const ahora = Date.now();
        if (ahora - ultimoChequeo >= MINUTOS_CHEQUEO * 60 * 1000) {
            ultimoChequeo = ahora;
            await chequearSitios(models, io);
        }

        // Dominios + purga: una vez por día (RDAP no cambia de un minuto al otro).
        const { Config, SitioChequeo } = models;
        const hoy = new Date().toISOString().slice(0, 10);
        const marca = await Config.findOne({ where: { name: CONFIG_DIARIO } });
        if (marca?.value === hoy) return;

        await revisarDominios(models, io);
        const corte = new Date(Date.now() - DIAS_HISTORIAL * 24 * 3600 * 1000);
        const borrados = await SitioChequeo.destroy({ where: { createdAt: { [Op.lt]: corte } } });

        if (marca) await marca.update({ value: hoy });
        else await Config.create({ name: CONFIG_DIARIO, value: hoy, description: 'Última revisión diaria de dominios de sitios (interno).' });

        console.log(`🌐 [SITIOS] Dominios revisados; ${borrados} chequeo(s) viejos purgados`);
    },
};
