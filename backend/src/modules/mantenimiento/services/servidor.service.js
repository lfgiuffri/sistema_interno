/**
 * Service del módulo `mantenimiento` — sección Servidores.
 *
 * Dos formas de saber si un servidor vive:
 *  - Los que administramos (`monitorea = true`) llevan un AGENTE que reporta CPU/RAM/disco
 *    cada minuto. El propio reporte es el heartbeat: si deja de llegar, está caído. Eso
 *    detecta también un servidor prendido pero colgado, que un ping no ve.
 *  - Los de terceros (`monitorea = false`) no llevan agente: el scheduler solo prueba abrir
 *    una conexión TCP a `puertoChequeo` para saber si responden.
 *
 * Los umbrales salen de la configuración global (`MANTENIMIENTO_UMBRAL_*`) salvo que el
 * servidor tenga los suyos: sirve para el que legítimamente vive al 95% de disco.
 */

import crypto from 'crypto';
import { Op } from 'sequelize';
import { getAppConfigNumber } from '../../../kernel/index.js';
import { abrirIncidente, resolverIncidente } from './alerta.service.js';

/**
 * Error de negocio con status (el controller lo mapea al envelope).
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje para el usuario.
 * @returns {Error} Error enriquecido.
 */
const bizError = (statusCode, message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

/**
 * Hash del token del agente. sha256 y no argon2 a propósito: el token es aleatorio de 256
 * bits (no hay diccionario que atacar) y esto se verifica en CADA reporte, una vez por
 * minuto y por servidor — un hash lento acá sería un costo permanente sin ganancia real.
 * @param {string} token - Token en claro.
 * @returns {string} Hash hexadecimal.
 */
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Umbrales vigentes para un servidor: los propios si los tiene, si no los globales.
 * @param {object} models - Modelos de la app.
 * @param {object} servidor - Servidor.
 * @returns {Promise<{cpu: number, ram: number, disco: number}>} Umbrales en %.
 */
export const umbralesDe = async (models, servidor) => ({
    cpu: servidor.umbralCpu ?? await getAppConfigNumber(models, 'MANTENIMIENTO_UMBRAL_CPU'),
    ram: servidor.umbralRam ?? await getAppConfigNumber(models, 'MANTENIMIENTO_UMBRAL_RAM'),
    disco: servidor.umbralDisco ?? await getAppConfigNumber(models, 'MANTENIMIENTO_UMBRAL_DISCO'),
});

// ─── ABM ─────────────────────────────────────────────────────────────────────────────

/**
 * Listado de servidores con su última métrica y los incidentes abiertos (sin N+1).
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object[]>} Servidores con `ultima` e `incidentes`.
 */
export const listServidores = async (models) => {
    const { Servidor, ServidorMetrica, ServidorIncidente } = models;
    const servidores = await Servidor.findAll({ order: [['nombre', 'ASC']] });
    if (!servidores.length) return [];
    const ids = servidores.map(s => s.id);

    // Última métrica de cada servidor: una query, quedándose con la más nueva por id.
    const metricas = await ServidorMetrica.findAll({
        where: { servidorId: { [Op.in]: ids } },
        order: [['servidorId', 'ASC'], ['createdAt', 'DESC']],
        raw: true,
    });
    const ultima = {};
    for (const m of metricas) if (!ultima[m.servidorId]) ultima[m.servidorId] = m;

    const abiertos = await ServidorIncidente.findAll({
        where: { servidorId: { [Op.in]: ids }, resueltoAt: null },
        raw: true,
    });
    const porServidor = {};
    for (const i of abiertos) (porServidor[i.servidorId] ??= []).push(i.tipo);

    return servidores.map(s => ({
        ...s.toJSON(),
        tieneToken: !!s.tokenHash,
        ultima: ultima[s.id]
            ? {
                cpu: Number(ultima[s.id].cpu),
                ram: Number(ultima[s.id].ram),
                disco: Number(ultima[s.id].disco),
                discos: ultima[s.id].discos,
                createdAt: ultima[s.id].createdAt,
            }
            : null,
        incidentes: porServidor[s.id] ?? [],
    }));
};

/**
 * Un servidor con su última métrica, su historial reciente y sus incidentes.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Servidor.
 * @param {number} [dias] - Ventana del historial fino (default 2 días).
 * @returns {Promise<object|null>} Ficha del servidor o null.
 */
export const getServidor = async (models, id, dias = 2) => {
    const { Servidor, ServidorMetrica, ServidorMetricaDia, ServidorIncidente } = models;
    const servidor = await Servidor.findByPk(id);
    if (!servidor) return null;

    const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);
    const [metricas, diarias, incidentes] = await Promise.all([
        ServidorMetrica.findAll({
            where: { servidorId: id, createdAt: { [Op.gte]: desde } },
            order: [['createdAt', 'ASC']],
            raw: true,
        }),
        ServidorMetricaDia.findAll({ where: { servidorId: id }, order: [['fecha', 'ASC']], raw: true }),
        ServidorIncidente.findAll({ where: { servidorId: id }, order: [['createdAt', 'DESC']], limit: 30, raw: true }),
    ]);

    return {
        ...servidor.toJSON(),
        tieneToken: !!servidor.tokenHash,
        umbrales: await umbralesDe(models, servidor),
        // Serie fina para el gráfico de las últimas horas.
        serie: metricas.map(m => ({
            t: m.createdAt,
            cpu: Number(m.cpu),
            ram: Number(m.ram),
            disco: Number(m.disco),
        })),
        // Serie diaria (promedio/máximo) para ver la tendencia larga.
        serieDiaria: diarias.map(d => ({
            fecha: d.fecha,
            cpu: Number(d.cpuProm), cpuMax: Number(d.cpuMax),
            ram: Number(d.ramProm), ramMax: Number(d.ramMax),
            disco: Number(d.discoProm), discoMax: Number(d.discoMax),
        })),
        ultima: metricas.length ? { ...metricas[metricas.length - 1] } : null,
        incidentes,
    };
};

/**
 * Crea un servidor y le genera su token de agente (se devuelve UNA sola vez).
 * @param {object} models - Modelos de la app.
 * @param {object} data - Campos del servidor.
 * @returns {Promise<{servidor: object, token: string|null}>} El servidor y su token en claro.
 */
export const createServidor = async (models, data) => {
    const { Servidor } = models;

    const existe = await Servidor.findOne({ where: { ip: data.ip } });
    if (existe) throw bizError(400, `Ya hay un servidor cargado con la IP ${data.ip}`);

    // Solo los que monitoreamos llevan agente, así que solo ellos necesitan token.
    const token = data.monitorea === false ? null : crypto.randomBytes(32).toString('hex');
    const servidor = await Servidor.create({ ...data, tokenHash: token ? hashToken(token) : null });
    return { servidor, token };
};

/**
 * Actualiza un servidor.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Servidor.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} El servidor actualizado o null si no existe.
 */
export const updateServidor = async (models, id, data) => {
    const { Servidor } = models;
    const servidor = await Servidor.findByPk(id);
    if (!servidor) return null;

    if (data.ip && data.ip !== servidor.ip) {
        const existe = await Servidor.findOne({ where: { ip: data.ip, id: { [Op.ne]: id } } });
        if (existe) throw bizError(400, `Ya hay un servidor cargado con la IP ${data.ip}`);
    }
    await servidor.update(data);
    return servidor;
};

/**
 * Regenera el token del agente (invalida el anterior de inmediato).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Servidor.
 * @returns {Promise<string|null>} El token nuevo en claro, o null si el servidor no existe.
 */
export const regenerarToken = async (models, id) => {
    const servidor = await models.Servidor.findByPk(id);
    if (!servidor) return null;
    const token = crypto.randomBytes(32).toString('hex');
    await servidor.update({ tokenHash: hashToken(token) });
    return token;
};

/**
 * Alterna el estado activo (un servidor inactivo no se monitorea ni alerta).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Servidor.
 * @returns {Promise<object|null>} El servidor o null.
 */
export const toggleServidor = async (models, id) => {
    const servidor = await models.Servidor.findByPk(id);
    if (!servidor) return null;
    await servidor.update({ activo: !servidor.activo });
    return servidor;
};

/**
 * Elimina (soft) un servidor y cierra sus incidentes abiertos.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Servidor.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 */
export const deleteServidor = async (models, id) => {
    const { Servidor, ServidorIncidente } = models;
    const servidor = await Servidor.findByPk(id);
    if (!servidor) return false;

    await ServidorIncidente.update({ resueltoAt: new Date() }, { where: { servidorId: id, resueltoAt: null } });
    await servidor.destroy();
    return true;
};

// ─── Ingesta del agente ──────────────────────────────────────────────────────────────

/**
 * Registra un reporte del agente: guarda la métrica, marca el servidor como online y
 * evalúa los umbrales (abriendo o cerrando incidentes según corresponda).
 *
 * Autenticación por token del servidor, no por sesión: esta ruta se monta FUERA del JWT.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO (para la campana en vivo).
 * @param {string} token - Token del agente (header `x-agent-token`).
 * @param {object} datos - { cpu, ram, disco, discos?, carga1?, uptimeSeg?, so? }.
 * @returns {Promise<{servidor: string, alertas: string[]}>} Resumen para el agente.
 * @throws {Error} 401 si el token no corresponde a ningún servidor monitoreado y activo.
 */
export const registrarMetrica = async (models, io, token, datos) => {
    const { Servidor, ServidorMetrica } = models;

    const servidor = await Servidor.findOne({ where: { tokenHash: hashToken(token) } });
    if (!servidor) throw bizError(401, 'Token de agente inválido');
    if (!servidor.activo || !servidor.monitorea) throw bizError(403, 'El servidor no está en monitoreo');

    const cpu = Number(datos.cpu);
    const ram = Number(datos.ram);
    const disco = Number(datos.disco);

    await ServidorMetrica.create({
        servidorId: servidor.id,
        cpu, ram, disco,
        discos: datos.discos ?? null,
        carga1: datos.carga1 ?? null,
        uptimeSeg: datos.uptimeSeg ?? null,
        createdAt: new Date(),
    });

    const estabaCaido = servidor.estado === 'offline';
    await servidor.update({
        ultimoContactoAt: new Date(),
        estado: 'online',
        ...(datos.so && !servidor.so ? { so: String(datos.so).slice(0, 120) } : {}),
    });
    if (estabaCaido) await resolverIncidente(models, io, servidor, 'offline');

    // Umbrales: se abre incidente al superarlos y se cierra al volver a la normalidad.
    const umbrales = await umbralesDe(models, servidor);
    const alertas = [];
    for (const [tipo, valor] of [['cpu', cpu], ['ram', ram], ['disco', disco]]) {
        if (valor >= umbrales[tipo]) {
            const detalle = tipo === 'disco' && Array.isArray(datos.discos)
                ? `Montaje más lleno: ${datos.discos.reduce((a, d) => (d.uso > (a?.uso ?? -1) ? d : a), null)?.montaje ?? '—'}.`
                : null;
            if (await abrirIncidente(models, io, servidor, { tipo, valor, umbral: umbrales[tipo], detalle })) alertas.push(tipo);
        } else {
            await resolverIncidente(models, io, servidor, tipo);
        }
    }

    return { servidor: servidor.nombre, alertas };
};
