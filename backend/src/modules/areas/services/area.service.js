/**
 * Service del módulo `areas` — TODA la lógica y el acceso a datos.
 *
 * Datos COLABORATIVOS (de la empresa): no se filtra por userId. Reglas:
 *  - Unicidad de nombre contra áreas NO eliminadas; si existe una eliminada homónima,
 *    se ofrece reactivarla (error 409 con `deletedId`) en vez del error genérico que
 *    daba el sistema legado.
 *  - Un área con servicios (no eliminados) no se elimina — y cuando exista el módulo
 *    de empleados, tampoco con empleados asignados (guard por presencia del modelo).
 */

import { Op } from 'sequelize';

/**
 * Error de negocio con status y datos extra (el controller lo mapea al envelope).
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje para el usuario.
 * @param {object} [extra] - Campos extra ({ errorCode, deletedId, ... }).
 * @returns {Error} Error enriquecido.
 */
const bizError = (statusCode, message, extra = {}) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    Object.assign(err, extra);
    return err;
};

/**
 * Valida unicidad de nombre. Si hay un área ELIMINADA con ese nombre, propone reactivarla.
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre a validar.
 * @param {number|null} excludeId - Id a excluir (edición).
 * @returns {Promise<void>}
 * @throws {Error} 400 si ya existe activa; 409 (errorCode EXISTE_ELIMINADO) si hay una eliminada.
 */
const checkNombreUnico = async (models, nombre, excludeId = null) => {
    const { Area } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};

    const vivo = await Area.findOne({ where: { nombre, ...idClause } });
    if (vivo) throw bizError(400, 'Ya existe un área con ese nombre');

    const eliminado = await Area.findOne({ where: { nombre, ...idClause }, paranoid: false });
    if (eliminado && eliminado.deletedAt) {
        throw bizError(409, `Ya existió un área llamada «${nombre}» (eliminada). Podés reactivarla.`, {
            errorCode: 'EXISTE_ELIMINADO',
            deletedId: eliminado.id
        });
    }
};

/**
 * Lista áreas con paginación, búsqueda y filtro de activo.
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - { page, limit, search, activo ('true'|'false') }.
 * @returns {Promise<{rows: object[], count: number, page: number, limit: number}>}
 */
export const listAreas = async (models, query = {}) => {
    const { Area, Servicio } = models;
    const where = {};
    if (query.search) where.nombre = { [Op.like]: `%${query.search}%` };
    if (query.activo !== undefined && query.activo !== '') where.activo = query.activo === 'true' || query.activo === true;

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);

    const { rows, count } = await Area.findAndCountAll({
        where,
        limit,
        offset: (page - 1) * limit,
        order: [['orden', 'ASC'], ['nombre', 'ASC']],
        distinct: true
    });

    // Conteo de servicios por área en UNA query (evita el N+1 del sistema legado).
    let serviciosPorArea = {};
    if (Servicio && rows.length) {
        const counts = await Servicio.findAll({
            attributes: ['areaId', [Servicio.sequelize.fn('COUNT', Servicio.sequelize.col('id')), 'n']],
            where: { areaId: { [Op.in]: rows.map(a => a.id) } },
            group: ['areaId'],
            raw: true
        });
        serviciosPorArea = Object.fromEntries(counts.map(c => [c.areaId, Number(c.n)]));
    }

    const shaped = rows.map(a => ({ ...a.toJSON(), serviciosCount: serviciosPorArea[a.id] || 0 }));
    return { rows: shaped, count, page, limit };
};

/**
 * Un área por id.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del área.
 * @returns {Promise<object|null>} El área o null.
 */
export const getArea = (models, id) => models.Area.findByPk(id);

/**
 * Crea un área (valida unicidad + reactivación).
 * @param {object} models - Modelos de la app.
 * @param {object} data - { nombre, descripcion?, orden?, activo? }.
 * @returns {Promise<object>} El área creada.
 */
export const createArea = async (models, data) => {
    await checkNombreUnico(models, data.nombre);
    return models.Area.create(data);
};

/**
 * Actualiza un área.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id a editar.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} El área actualizada o null si no existe.
 */
export const updateArea = async (models, id, data) => {
    const area = await models.Area.findByPk(id);
    if (!area) return null;
    if (data.nombre && data.nombre !== area.nombre) {
        await checkNombreUnico(models, data.nombre, id);
    }
    await area.update(data);
    return area;
};

/**
 * Alterna el estado activo.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del área.
 * @returns {Promise<object|null>} El área actualizada o null.
 */
export const toggleArea = async (models, id) => {
    const area = await models.Area.findByPk(id);
    if (!area) return null;
    await area.update({ activo: !area.activo });
    return area;
};

/**
 * Reactiva un área eliminada (restore del soft delete). Falla si el nombre ya fue
 * reutilizado por un área viva.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del área eliminada.
 * @returns {Promise<object|null>} El área restaurada o null si no existe.
 */
export const restoreArea = async (models, id) => {
    const { Area } = models;
    const area = await Area.findByPk(id, { paranoid: false });
    if (!area || !area.deletedAt) return null;

    const vivo = await Area.findOne({ where: { nombre: area.nombre } });
    if (vivo) throw bizError(400, 'Ya existe un área activa con ese nombre; renombrala primero');

    await area.restore();
    return area;
};

/**
 * Elimina (soft) un área. Protección: no se elimina si tiene servicios (y, cuando exista
 * el módulo de empleados, tampoco con empleados asignados).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del área.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si está en uso.
 */
export const deleteArea = async (models, id) => {
    const { Area, Servicio, EmpleadoArea } = models;
    const area = await Area.findByPk(id);
    if (!area) return false;

    const partes = [];
    if (Servicio) {
        const n = await Servicio.count({ where: { areaId: id } });
        if (n > 0) partes.push(`${n} servicio(s)`);
    }
    // Guard por presencia: el modelo llega en la fase 5 (empleados) y el check se activa solo.
    if (EmpleadoArea) {
        const n = await EmpleadoArea.count({ where: { areaId: id } });
        if (n > 0) partes.push(`${n} empleado(s)`);
    }
    if (partes.length) {
        throw bizError(409, `No se puede eliminar: el área está asignada a ${partes.join(' y ')}. Reasignalos primero.`);
    }

    await area.destroy();
    return true;
};
