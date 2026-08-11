/**
 * Avisos automáticos diarios (mejora §10.7 del PRD) — corre en el scheduler (tick por
 * minuto) pero trabaja UNA vez por día (marca de última corrida en Config):
 *  - Abonos con actualización de precio vencida o por vencer (≤ 7 días) → notifica a los
 *    usuarios cuyo rol puede `abonos:actualizar-precio`.
 *  - Tareas que vencen HOY o ya vencidas → notifica a su asignado.
 * Solo notificaciones in-app + socket (el mail queda para cuando haya SMTP configurado).
 */

import { Op } from 'sequelize';

const CONFIG_KEY = 'AVISOS_ULTIMA_CORRIDA';

/**
 * Usuarios activos cuyo rol tiene la capability (o el comodín).
 * @param {object} models - Modelos de la app.
 * @param {string} cap - Capability.
 * @returns {Promise<number[]>} Ids de usuarios.
 */
const usuariosConCapability = async (models, cap) => {
    const roles = (await models.RoleCapability.findAll({
        where: { capability: { [Op.in]: ['*', cap] } },
        attributes: ['roleId'],
        raw: true
    })).map(r => r.roleId);
    if (!roles.length) return [];
    const users = await models.User.findAll({
        where: { active: true, roleId: { [Op.in]: [...new Set(roles)] } },
        attributes: ['id'],
        raw: true
    });
    return users.map(u => u.id);
};

/**
 * Handler del scheduler: avisos diarios de abonos y tareas.
 * @type {{name: string, run: (ctx: {db: object, models: object, io: object}) => Promise<void>}}
 */
export const avisosHandler = {
    name: 'avisos-diarios',
    run: async ({ models, io }) => {
        const { Config, Abono, Tarea, Notificacion } = models;
        if (!Config || !Notificacion) return;

        // Una corrida por día (la marca vive en Config; el tick es por minuto).
        const hoy = new Date().toISOString().slice(0, 10);
        const marca = await Config.findOne({ where: { name: CONFIG_KEY } });
        if (marca?.value === hoy) return;
        if (marca) await marca.update({ value: hoy });
        else await Config.create({ name: CONFIG_KEY, value: hoy, description: 'Última corrida de los avisos diarios (interno).' });

        const { crearNotificacion } = await import('../notificaciones/notificaciones.service.js');

        // 1) Abonos vencidos o por vencer (≤ 7 días) → quienes pueden actualizar precios.
        if (Abono) {
            const SQL_DIAS = 'DATEDIFF(DATE_ADD(COALESCE(`abonos`.`fechaUltimaActualizacion`, `abonos`.`fechaInicio`), INTERVAL `abonos`.`periodoMeses` MONTH), CURDATE())';
            const abonos = await Abono.findAll({
                where: { activo: true },
                attributes: { include: [[Abono.sequelize.literal(SQL_DIAS), 'dias']] },
                include: [{ model: models.Cliente, attributes: ['nombre'] }]
            });
            const urgentes = abonos.map(a => a.toJSON()).filter(a => a.dias !== null && a.dias <= 7);
            if (urgentes.length) {
                const vencidos = urgentes.filter(a => a.dias < 0).length;
                const destinatarios = await usuariosConCapability(models, 'abonos:actualizar-precio');
                for (const userId of destinatarios) {
                    await crearNotificacion(models, io, {
                        userId,
                        tipo: 'abono-vencido',
                        titulo: `${urgentes.length} abono(s) por actualizar`,
                        cuerpo: vencidos
                            ? `${vencidos} ya vencido(s) — ${urgentes.slice(0, 3).map(a => a.cliente?.nombre).filter(Boolean).join(', ')}`
                            : `Vencen dentro de 7 días — ${urgentes.slice(0, 3).map(a => a.cliente?.nombre).filter(Boolean).join(', ')}`,
                        url: '/abonos?estado=vencido'
                    });
                }
            }
        }

        // 2) Tareas que vencen hoy o vencidas → su asignado (agrupadas por persona).
        if (Tarea) {
            const pendientes = await Tarea.findAll({
                where: {
                    estado: { [Op.in]: ['abierta', 'en_progreso', 'pausada', 'en_revision'] },
                    asignadoA: { [Op.ne]: null },
                    fechaVencimiento: { [Op.lte]: hoy }
                },
                attributes: ['id', 'nombre', 'asignadoA', 'fechaVencimiento'],
                raw: true
            });
            const porUsuario = {};
            for (const t of pendientes) (porUsuario[t.asignadoA] ??= []).push(t);
            for (const [userId, tareas] of Object.entries(porUsuario)) {
                const vencidas = tareas.filter(t => t.fechaVencimiento < hoy).length;
                await crearNotificacion(models, io, {
                    userId: Number(userId),
                    tipo: 'tarea-vencimiento',
                    titulo: vencidas
                        ? `Tenés ${tareas.length} tarea(s) vencida(s) o que vencen hoy`
                        : `Tenés ${tareas.length} tarea(s) que vencen hoy`,
                    cuerpo: tareas.slice(0, 3).map(t => t.nombre).join(' · '),
                    url: '/tareas/resumen?f=vencidas'
                });
            }
        }
    }
};
