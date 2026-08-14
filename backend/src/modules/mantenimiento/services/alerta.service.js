/**
 * Alertas del módulo de mantenimiento: incidentes + aviso multicanal.
 *
 * Regla anti-spam: mientras un problema sigue abierto NO se vuelve a notificar. Se avisa dos
 * veces —cuando se abre y cuando se resuelve— y el incidente queda en la bitácora con su
 * duración. Un solo incidente abierto por servidor y tipo.
 *
 * Canales: campana in-app (siempre), email (si hay SMTP configurado) y push (si el usuario
 * tiene token de dispositivo). Los que no están configurados se saltean en silencio: el
 * monitoreo nunca falla por un canal caído.
 */

import { Op } from 'sequelize';
import { crearNotificacion } from '../../../kernel/index.js';
import { isSmtpConfigured, sendMail } from '../../../kernel/mail/mailer.js';
import { sendSmartNotification } from '../../../services/push/services/push.service.js';

/** Capability cuyos titulares reciben las alertas de servidores. */
const CAPABILITY_ALERTAS = 'servidores:read';

/**
 * Usuarios activos cuyo rol tiene la capability (o el comodín), con su email y su push.
 * @param {object} models - Modelos de la app.
 * @param {string} cap - Capability requerida.
 * @returns {Promise<Array<{id: number, email: string, settings: object|null}>>} Destinatarios.
 */
const destinatarios = async (models, cap) => {
    const roles = (await models.RoleCapability.findAll({
        where: { capability: { [Op.in]: ['*', cap] } },
        attributes: ['roleId'],
        raw: true,
    })).map(r => r.roleId);
    if (!roles.length) return [];

    const users = await models.User.findAll({
        where: { active: true, roleId: { [Op.in]: [...new Set(roles)] } },
        attributes: ['id', 'name', 'email'],
        raw: true,
    });
    if (!users.length) return [];

    const settings = models.UserSettings
        ? await models.UserSettings.findAll({ where: { userId: { [Op.in]: users.map(u => u.id) } }, raw: true })
        : [];
    const porUsuario = Object.fromEntries(settings.map(s => [s.userId, s]));

    return users.map(u => ({ ...u, settings: porUsuario[u.id] ?? null }));
};

/**
 * Manda un aviso por los tres canales a quienes tienen la capability indicada.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO (para la campana en vivo).
 * @param {{tipo: string, titulo: string, cuerpo: string, url?: string}} aviso - Contenido.
 * @param {string} [capability] - Capability de los destinatarios (default: servidores).
 * @returns {Promise<number>} Cantidad de destinatarios avisados.
 */
export const avisar = async (models, io, aviso, capability = CAPABILITY_ALERTAS) => {
    const users = await destinatarios(models, capability);

    for (const u of users) {
        // 1. Campana in-app: siempre (es el canal que no depende de nada externo).
        await crearNotificacion(models, io, {
            userId: u.id,
            tipo: aviso.tipo,
            titulo: aviso.titulo,
            cuerpo: aviso.cuerpo,
            url: aviso.url ?? '/mantenimiento/servidores',
        });

        // 2. Email: solo si hay SMTP configurado (si no, sendMail loguearía a consola).
        if (isSmtpConfigured() && u.email) {
            await sendMail({
                to: u.email,
                subject: aviso.titulo,
                text: `${aviso.cuerpo}\n\nSistema Interno — Mantenimiento`,
            }).catch(() => null); // un email caído no puede tumbar el monitoreo
        }

        // 3. Push: solo si el usuario registró un dispositivo (respeta su horario silencioso).
        if (u.settings?.pushToken) {
            await sendSmartNotification(u.settings, aviso.titulo, aviso.cuerpo, { url: aviso.url ?? '' }, 'high')
                .catch(() => null);
        }
    }

    return users.length;
};

/**
 * Abre un incidente si no había uno abierto de ese tipo, y avisa UNA sola vez.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @param {object} servidor - Servidor afectado.
 * @param {{tipo: string, valor?: number, umbral?: number, detalle?: string}} datos - Problema.
 * @returns {Promise<boolean>} true si abrió (y avisó) un incidente nuevo.
 */
export const abrirIncidente = async (models, io, servidor, datos) => {
    const { ServidorIncidente } = models;

    const abierto = await ServidorIncidente.findOne({
        where: { servidorId: servidor.id, tipo: datos.tipo, resueltoAt: null },
    });
    if (abierto) return false; // ya avisamos: no se repite

    await ServidorIncidente.create({
        servidorId: servidor.id,
        tipo: datos.tipo,
        valor: datos.valor ?? null,
        umbral: datos.umbral ?? null,
        detalle: datos.detalle ?? null,
        createdAt: new Date(),
    });

    const titulos = {
        offline: `🔴 ${servidor.nombre} no responde`,
        cpu: `⚠️ CPU alta en ${servidor.nombre}`,
        ram: `⚠️ Memoria alta en ${servidor.nombre}`,
        disco: `⚠️ Disco casi lleno en ${servidor.nombre}`,
    };
    const cuerpo = datos.tipo === 'offline'
        ? `${servidor.nombre} (${servidor.ip}) dejó de responder.`
        : `${servidor.nombre} (${servidor.ip}): ${datos.valor}% supera el umbral de ${datos.umbral}%.${datos.detalle ? ` ${datos.detalle}` : ''}`;

    await avisar(models, io, {
        tipo: `servidor-${datos.tipo}`,
        titulo: titulos[datos.tipo] ?? `Alerta en ${servidor.nombre}`,
        cuerpo,
        url: `/mantenimiento/servidores/${servidor.id}`,
    });
    return true;
};

/**
 * Cierra el incidente abierto de ese tipo (si hay) y avisa que se normalizó.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @param {object} servidor - Servidor.
 * @param {string} tipo - Tipo de incidente.
 * @returns {Promise<boolean>} true si había uno abierto y se cerró.
 */
export const resolverIncidente = async (models, io, servidor, tipo) => {
    const { ServidorIncidente } = models;

    const abierto = await ServidorIncidente.findOne({
        where: { servidorId: servidor.id, tipo, resueltoAt: null },
    });
    if (!abierto) return false;

    const ahora = new Date();
    await abierto.update({ resueltoAt: ahora });

    const minutos = Math.max(1, Math.round((ahora - new Date(abierto.createdAt)) / 60000));
    const etiquetas = { offline: 'volvió a responder', cpu: 'normalizó la CPU', ram: 'normalizó la memoria', disco: 'liberó espacio en disco' };

    await avisar(models, io, {
        tipo: `servidor-ok`,
        titulo: `✅ ${servidor.nombre} se recuperó`,
        cuerpo: `${servidor.nombre} ${etiquetas[tipo] ?? 'se normalizó'} después de ${minutos} minuto(s).`,
        url: `/mantenimiento/servidores/${servidor.id}`,
    });
    return true;
};
