/**
 * Service del módulo `empleados` — ficha, áreas N:N y vacaciones.
 *
 * Reglas del legado (../analisis_app_php/04 §3) + mejoras del PRD:
 *  - Freelance no genera vacaciones; el valor de vacDiasAnuales se conserva igual.
 *  - Las áreas se reemplazan completas al guardar (ids válidas contra áreas no eliminadas).
 *  - MEJORA: no se elimina un empleado con historial de sueldos, pagos o archivos.
 *  - MEJORA: los listados calculan vacaciones y áreas en queries por lote (sin N+1).
 */

import { Op } from 'sequelize';
import { CATEGORIAS_EMPLEADO } from '../models/Empleado.js';
import { estadoVacaciones, usaVacaciones, diasCorridos, disponibleAl, tomaSolapada } from './vacaciones.service.js';

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
 * Áreas por empleado en UNA query (nombre incluido).
 * @param {object} models - Modelos de la app.
 * @param {number[]} empleadoIds - Ids a resolver.
 * @returns {Promise<Record<number, Array<{id: number, nombre: string}>>>}
 */
const areasPorEmpleado = async (models, empleadoIds) => {
    const { EmpleadoArea, Area } = models;
    if (!empleadoIds.length) return {};
    const filas = await EmpleadoArea.findAll({
        where: { empleadoId: { [Op.in]: empleadoIds } },
        include: [{ model: Area, attributes: ['id', 'nombre'], paranoid: false }]
    });
    const mapa = {};
    for (const f of filas) {
        if (!f.area) continue;
        (mapa[f.empleadoId] ??= []).push({ id: f.area.id, nombre: f.area.nombre });
    }
    return mapa;
};

/**
 * Estados de vacaciones por empleado en DOS queries (el legado hacía 3-4 por fila).
 * @param {object} models - Modelos de la app.
 * @param {object[]} empleados - Empleados (POJOs o instancias).
 * @returns {Promise<Record<number, object>>} empleadoId → estado resumido.
 */
const vacacionesPorEmpleado = async (models, empleados) => {
    const { VacacionAsignacion, VacacionToma } = models;
    const ids = empleados.map(e => e.id);
    if (!ids.length) return {};
    const [asignaciones, tomas] = await Promise.all([
        VacacionAsignacion.findAll({ where: { empleadoId: { [Op.in]: ids } }, raw: true }),
        VacacionToma.findAll({ where: { empleadoId: { [Op.in]: ids } }, raw: true })
    ]);
    const asigPor = {}, tomasPor = {};
    for (const a of asignaciones) (asigPor[a.empleadoId] ??= []).push(a);
    for (const t of tomas) (tomasPor[t.empleadoId] ??= []).push(t);

    return Object.fromEntries(empleados.map(e => {
        const est = estadoVacaciones(e, asigPor[e.id] || [], tomasPor[e.id] || []);
        return [e.id, est.aplica
            ? { aplica: true, disponible: est.disponible, sobregiro: est.sobregiro }
            : { aplica: false }];
    }));
};

/**
 * Listado de empleados con áreas y vacaciones (activos primero, orden de alta).
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object[]>} Empleados enriquecidos.
 */
export const listEmpleados = async (models) => {
    const { Empleado } = models;
    const empleados = await Empleado.findAll({
        order: [['activo', 'DESC'], ['createdAt', 'ASC'], ['id', 'ASC']]
    });
    const pojos = empleados.map(e => e.toJSON());
    const [areas, vacaciones] = await Promise.all([
        areasPorEmpleado(models, pojos.map(e => e.id)),
        vacacionesPorEmpleado(models, pojos)
    ]);
    return pojos.map(e => ({
        ...e,
        sueldo: Number(e.sueldo),
        areas: areas[e.id] || [],
        vacaciones: vacaciones[e.id]
    }));
};

/**
 * Valida y normaliza el payload de la ficha.
 * @param {object} data - Payload validado por express-validator.
 * @returns {object} Data lista para persistir (vacíos → null).
 * @throws {Error} 400 con el mensaje del legado.
 */
const normalizarFicha = (data) => {
    if (!data.nombre?.trim()) throw bizError(400, 'El nombre completo es obligatorio');
    const categoria = CATEGORIAS_EMPLEADO.includes(data.categoria) ? data.categoria : 'Relación de dependencia';
    const limpio = {};
    for (const campo of ['nombre', 'dni', 'cuil', 'nacionalidad', 'domicilio', 'telefono', 'email',
        'estadoCivil', 'cargasFamiliares', 'cuNombre', 'cuTelefono', 'cuParentesco', 'observaciones']) {
        const v = typeof data[campo] === 'string' ? data[campo].trim() : data[campo];
        limpio[campo] = v || null;
    }
    limpio.nombre = data.nombre.trim();
    limpio.fechaNacimiento = data.fechaNacimiento || null;
    limpio.fechaIngreso = data.fechaIngreso || null;
    limpio.categoria = categoria;
    limpio.vacDiasAnuales = Math.max(0, Math.trunc(Number(data.vacDiasAnuales ?? 14)) || 0);
    return limpio;
};

/**
 * Reemplaza las áreas del empleado (ids válidas contra áreas NO eliminadas).
 * @param {object} models - Modelos de la app.
 * @param {number} empleadoId - Empleado.
 * @param {number[]} areaIds - Ids nuevas.
 * @param {object} t - Transacción.
 * @returns {Promise<void>}
 */
const guardarAreas = async (models, empleadoId, areaIds, t) => {
    const { EmpleadoArea, Area } = models;
    const validas = (await Area.findAll({ attributes: ['id'], raw: true, transaction: t })).map(a => a.id);
    await EmpleadoArea.destroy({ where: { empleadoId }, transaction: t });
    const filas = [...new Set(areaIds.map(Number))]
        .filter(id => validas.includes(id))
        .map(areaId => ({ empleadoId, areaId }));
    if (filas.length) await EmpleadoArea.bulkCreate(filas, { transaction: t });
};

/**
 * Crea un empleado (el sueldo NO se toca acá: se carga desde el módulo Sueldos).
 * @param {object} models - Modelos de la app.
 * @param {object} data - Ficha + areas[].
 * @returns {Promise<object>} El empleado creado.
 */
export const createEmpleado = async (models, data) => {
    const ficha = normalizarFicha(data);
    return models.Empleado.sequelize.transaction(async (t) => {
        const empleado = await models.Empleado.create(ficha, { transaction: t });
        await guardarAreas(models, empleado.id, data.areas || [], t);
        return empleado;
    });
};

/**
 * Actualiza la ficha (sin tocar `sueldo` ni `activo`).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Empleado.
 * @param {object} data - Ficha + areas[].
 * @returns {Promise<object|null>} El empleado o null.
 */
export const updateEmpleado = async (models, id, data) => {
    const empleado = await models.Empleado.findByPk(id);
    if (!empleado) return null;
    const ficha = normalizarFicha(data);
    await models.Empleado.sequelize.transaction(async (t) => {
        await empleado.update(ficha, { transaction: t });
        await guardarAreas(models, empleado.id, data.areas || [], t);
    });
    return empleado;
};

/**
 * Alterna activo.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Empleado.
 * @returns {Promise<object|null>} El empleado o null.
 */
export const toggleEmpleado = async (models, id) => {
    const empleado = await models.Empleado.findByPk(id);
    if (!empleado) return null;
    await empleado.update({ activo: !empleado.activo });
    return empleado;
};

/**
 * Elimina (soft). MEJORA sobre el legado: con historial de sueldos, pagos o archivos
 * no se elimina (antes quedaban huérfanos silenciosos).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Empleado.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si tiene datos asociados.
 */
export const deleteEmpleado = async (models, id) => {
    const { Empleado, SueldoActualizacion, SueldoPago, EmpleadoArchivo } = models;
    const empleado = await Empleado.findByPk(id);
    if (!empleado) return false;

    const partes = [];
    if (SueldoActualizacion) {
        const n = await SueldoActualizacion.count({ where: { empleadoId: id } });
        if (n > 0) partes.push(`${n} registro(s) de sueldo`);
    }
    if (SueldoPago) {
        const n = await SueldoPago.count({ where: { empleadoId: id } });
        if (n > 0) partes.push(`${n} pago(s) planificado(s)`);
    }
    if (EmpleadoArchivo) {
        const n = await EmpleadoArchivo.count({ where: { empleadoId: id } });
        if (n > 0) partes.push(`${n} archivo(s)`);
    }
    if (partes.length) {
        throw bizError(409, `No se puede eliminar: el empleado tiene ${partes.join(', ')}. Desactivalo en su lugar.`);
    }

    await models.EmpleadoArea.destroy({ where: { empleadoId: id } });
    await empleado.destroy();
    return true;
};

/**
 * Ficha completa: datos + áreas + vacaciones (estado, tomas con sobregiro recalculado,
 * grants por año) + archivos.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Empleado.
 * @returns {Promise<object|null>} La ficha o null.
 */
export const getFicha = async (models, id) => {
    const { Empleado, VacacionAsignacion, VacacionToma, EmpleadoArchivo, User } = models;
    const empleado = await Empleado.findByPk(id);
    if (!empleado) return null;

    const [areas, asignaciones, tomas, archivos] = await Promise.all([
        areasPorEmpleado(models, [empleado.id]),
        VacacionAsignacion.findAll({ where: { empleadoId: id }, order: [['anio', 'DESC']], raw: true }),
        VacacionToma.findAll({ where: { empleadoId: id }, raw: true }),
        EmpleadoArchivo.findAll({
            where: { empleadoId: id },
            include: [{ model: User, attributes: ['id', 'name', 'lastName'], required: false, paranoid: false }],
            order: [['createdAt', 'DESC']]
        })
    ]);

    const vacaciones = estadoVacaciones(empleado.toJSON(), asignaciones, tomas);
    // Origen de cada grant (ajuste u otorgamiento por defecto), para la tabla de la ficha.
    const overrides = new Set(asignaciones.map(a => Number(a.anio)));
    const grantsDetalle = vacaciones.aplica
        ? Object.entries(vacaciones.grants)
            .map(([anio, dias]) => ({ anio: Number(anio), dias, origen: overrides.has(Number(anio)) ? 'ajuste' : 'por defecto' }))
            .sort((a, b) => b.anio - a.anio)
        : [];

    return {
        ...empleado.toJSON(),
        sueldo: Number(empleado.sueldo),
        areas: areas[empleado.id] || [],
        vacaciones: vacaciones.aplica ? { ...vacaciones, grants: undefined, grantsDetalle } : { aplica: false },
        archivos: archivos.map(a => ({
            id: a.id,
            descripcion: a.descripcion,
            nombreOriginal: a.nombreOriginal,
            mime: a.mime,
            size: a.size,
            fecha: a.createdAt,
            usuario: a.user ? `${a.user.name} ${a.user.lastName}`.trim() : null
        }))
    };
};

// ─────────────────────────── Vacaciones (acciones) ───────────────────────────

/**
 * Guarda global del legado: la categoría tiene que generar vacaciones.
 * @param {object} empleado - Empleado.
 * @throws {Error} 400 con el mensaje del legado.
 */
const exigirUsaVacaciones = (empleado) => {
    if (!usaVacaciones(empleado)) throw bizError(400, 'Esta categoría de empleado no genera vacaciones');
};

/**
 * Registra una toma de vacaciones (días corridos inclusive, valida disponibilidad a la
 * fecha + MEJORA: solapamiento con períodos existentes).
 * @param {object} models - Modelos de la app.
 * @param {number} empleadoId - Empleado.
 * @param {object} data - { fechaDesde, fechaHasta, observacion? }.
 * @param {number} userId - Quién registra.
 * @returns {Promise<object>} La toma creada (con días).
 */
export const addToma = async (models, empleadoId, data, userId) => {
    const { Empleado, VacacionAsignacion, VacacionToma } = models;
    const empleado = await Empleado.findByPk(empleadoId);
    if (!empleado) throw bizError(404, 'Empleado no encontrado');
    exigirUsaVacaciones(empleado);

    const { fechaDesde, fechaHasta } = data;
    if (fechaHasta < fechaDesde) throw bizError(400, 'La fecha de fin no puede ser anterior a la de inicio');

    const [asignaciones, tomas] = await Promise.all([
        VacacionAsignacion.findAll({ where: { empleadoId }, raw: true }),
        VacacionToma.findAll({ where: { empleadoId }, raw: true })
    ]);

    const solapada = tomaSolapada(tomas, fechaDesde, fechaHasta);
    if (solapada) {
        throw bizError(400, `El período se solapa con vacaciones ya cargadas (${solapada.fechaDesde} a ${solapada.fechaHasta})`);
    }

    const dias = diasCorridos(fechaDesde, fechaHasta);
    const disp = disponibleAl(empleado.toJSON(), asignaciones, tomas, fechaDesde);
    if (dias > disp) {
        throw bizError(400, `No alcanzan los días disponibles: pedís ${dias} y hay ${disp} disponible(s) a esa fecha `
            + '(recordá que primero se consumen los del año anterior y que vencen al año siguiente)');
    }

    return VacacionToma.create({
        empleadoId,
        fechaDesde,
        fechaHasta,
        dias,
        observacion: data.observacion?.trim() || null,
        userId
    });
};

/**
 * Elimina una toma (borrado físico, scoped al empleado). 404 real si no existe
 * (el legado flasheaba éxito igual).
 * @param {object} models - Modelos de la app.
 * @param {number} empleadoId - Empleado.
 * @param {number} tomaId - Toma.
 * @returns {Promise<boolean>} true si se eliminó.
 */
export const deleteToma = async (models, empleadoId, tomaId) => {
    const n = await models.VacacionToma.destroy({ where: { id: tomaId, empleadoId } });
    return n > 0;
};

/**
 * Setea (o quita) el override de días para un año. `dias` null/'' → se quita el ajuste
 * y el año vuelve al valor por defecto.
 * @param {object} models - Modelos de la app.
 * @param {number} empleadoId - Empleado.
 * @param {number} anio - Año (2000–2100, validado antes).
 * @param {number|null} dias - Días (>= 0) o null para quitar.
 * @returns {Promise<{quitado: boolean}>}
 */
export const setAsignacion = async (models, empleadoId, anio, dias) => {
    const { Empleado, VacacionAsignacion } = models;
    const empleado = await Empleado.findByPk(empleadoId);
    if (!empleado) throw bizError(404, 'Empleado no encontrado');
    exigirUsaVacaciones(empleado);

    if (dias === null || dias === undefined || dias === '') {
        await VacacionAsignacion.destroy({ where: { empleadoId, anio } });
        return { quitado: true };
    }
    const valor = Math.max(0, Math.trunc(Number(dias)) || 0);
    const existente = await VacacionAsignacion.findOne({ where: { empleadoId, anio } });
    if (existente) await existente.update({ dias: valor });
    else await VacacionAsignacion.create({ empleadoId, anio, dias: valor });
    return { quitado: false };
};
