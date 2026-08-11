/**
 * Service del módulo `servicios` — TODA la lógica y el acceso a datos.
 *
 * Reglas:
 *  - Unicidad de nombre (el legado no la tenía) con oferta de reactivación.
 *  - El área asignada debe existir y no estar eliminada; puede estar INACTIVA
 *    (el valor actual nunca se pierde por estar inactivo — corrige el patrón del
 *    legado que "perdía" valores fuera del select, bug §7.2.7 del análisis).
 *  - Un servicio con abonos o proyectos no se elimina (el legado lo borraba sin
 *    protección — bug #12); los guards se activan solos cuando existan esos módulos.
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
 * Valida unicidad de nombre; si hay un servicio ELIMINADO homónimo, propone reactivarlo.
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre a validar.
 * @param {number|null} excludeId - Id a excluir (edición).
 * @returns {Promise<void>}
 * @throws {Error} 400 si ya existe; 409 (EXISTE_ELIMINADO) si hay uno eliminado.
 */
const checkNombreUnico = async (models, nombre, excludeId = null) => {
    const { Servicio } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};

    const vivo = await Servicio.findOne({ where: { nombre, ...idClause } });
    if (vivo) throw bizError(400, 'Ya existe un servicio con ese nombre');

    const eliminado = await Servicio.findOne({ where: { nombre, ...idClause }, paranoid: false });
    if (eliminado && eliminado.deletedAt) {
        throw bizError(409, `Ya existió un servicio llamado «${nombre}» (eliminado). Podés reactivarlo.`, {
            errorCode: 'EXISTE_ELIMINADO',
            deletedId: eliminado.id
        });
    }
};

/**
 * Normaliza y valida el areaId de entrada: 0/null → null; >0 → el área debe existir
 * (puede estar inactiva, pero no eliminada).
 * @param {object} models - Modelos de la app.
 * @param {number|null|undefined} areaId - Área elegida.
 * @returns {Promise<number|null>} areaId normalizado.
 * @throws {Error} 400 si el área no existe.
 */
const resolveAreaId = async (models, areaId) => {
    if (areaId === undefined) return undefined; // no tocar
    const id = Number(areaId) || 0;
    if (id <= 0) return null;
    const area = await models.Area.findByPk(id);
    if (!area) throw bizError(400, 'El área seleccionada no existe');
    return id;
};

/** Include del área para las respuestas (id + nombre + activo alcanza para la UI). */
const areaInclude = (models) => models.Area
    ? [{ model: models.Area, attributes: ['id', 'nombre', 'activo'] }]
    : [];

/**
 * Lista servicios con paginación, búsqueda, filtro de activo y de área.
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - { page, limit, search, activo, areaId }.
 * @returns {Promise<{rows: object[], count: number, page: number, limit: number}>}
 */
export const listServicios = async (models, query = {}) => {
    const { Servicio, Abono } = models;
    const where = {};
    if (query.search) where.nombre = { [Op.like]: `%${query.search}%` };
    if (query.activo !== undefined && query.activo !== '') where.activo = query.activo === 'true' || query.activo === true;
    if (query.areaId) where.areaId = Number(query.areaId);

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);

    const { rows, count } = await Servicio.findAndCountAll({
        where,
        include: areaInclude(models),
        limit,
        offset: (page - 1) * limit,
        order: [['activo', 'DESC'], ['nombre', 'ASC']],
        distinct: true
    });

    // Conteo de abonos por servicio en UNA query (cuando el módulo exista).
    let abonosPorServicio = {};
    if (Abono && rows.length) {
        const counts = await Abono.findAll({
            attributes: ['servicioId', [Abono.sequelize.fn('COUNT', Abono.sequelize.col('id')), 'n']],
            where: { servicioId: { [Op.in]: rows.map(s => s.id) } },
            group: ['servicioId'],
            raw: true
        });
        abonosPorServicio = Object.fromEntries(counts.map(c => [c.servicioId, Number(c.n)]));
    }

    const shaped = rows.map(s => ({ ...s.toJSON(), abonosCount: abonosPorServicio[s.id] || 0 }));
    return { rows: shaped, count, page, limit };
};

/**
 * Un servicio por id (con su área).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del servicio.
 * @returns {Promise<object|null>} El servicio o null.
 */
export const getServicio = (models, id) =>
    models.Servicio.findByPk(id, { include: areaInclude(models) });

/**
 * Crea un servicio (unicidad + área validada).
 * @param {object} models - Modelos de la app.
 * @param {object} data - { nombre, descripcion?, areaId?, activo? }.
 * @returns {Promise<object>} El servicio creado (con área).
 */
export const createServicio = async (models, data) => {
    await checkNombreUnico(models, data.nombre);
    const areaId = await resolveAreaId(models, data.areaId ?? null);
    const created = await models.Servicio.create({ ...data, areaId });
    return getServicio(models, created.id);
};

/**
 * Actualiza un servicio.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id a editar.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} El servicio actualizado (con área) o null.
 */
export const updateServicio = async (models, id, data) => {
    const servicio = await models.Servicio.findByPk(id);
    if (!servicio) return null;
    if (data.nombre && data.nombre !== servicio.nombre) {
        await checkNombreUnico(models, data.nombre, id);
    }
    const areaId = await resolveAreaId(models, data.areaId);
    await servicio.update({ ...data, ...(areaId !== undefined && { areaId }) });
    return getServicio(models, id);
};

/**
 * Alterna el estado activo. Desactivar un servicio lo saca de los selects de alta,
 * pero NO afecta a los abonos/proyectos existentes (regla del legado que se conserva).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del servicio.
 * @returns {Promise<object|null>} El servicio actualizado o null.
 */
export const toggleServicio = async (models, id) => {
    const servicio = await models.Servicio.findByPk(id);
    if (!servicio) return null;
    await servicio.update({ activo: !servicio.activo });
    return getServicio(models, id);
};

/**
 * Reactiva un servicio eliminado.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del servicio eliminado.
 * @returns {Promise<object|null>} El servicio restaurado o null.
 */
export const restoreServicio = async (models, id) => {
    const { Servicio } = models;
    const servicio = await Servicio.findByPk(id, { paranoid: false });
    if (!servicio || !servicio.deletedAt) return null;

    const vivo = await Servicio.findOne({ where: { nombre: servicio.nombre } });
    if (vivo) throw bizError(400, 'Ya existe un servicio activo con ese nombre; renombralo primero');

    await servicio.restore();
    return getServicio(models, id);
};

/**
 * Elimina (soft) un servicio. Protección: abonos y proyectos que lo usan.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del servicio.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si está en uso.
 */
export const deleteServicio = async (models, id) => {
    const { Servicio, Abono, Proyecto } = models;
    const servicio = await Servicio.findByPk(id);
    if (!servicio) return false;

    const partes = [];
    if (Abono) {
        const n = await Abono.count({ where: { servicioId: id } });
        if (n > 0) partes.push(`${n} abono(s)`);
    }
    if (Proyecto) {
        const n = await Proyecto.count({ where: { servicioId: id } });
        if (n > 0) partes.push(`${n} proyecto(s)`);
    }
    if (partes.length) {
        throw bizError(409, `No se puede eliminar: el servicio está en uso por ${partes.join(' y ')}. Reasignalos primero.`);
    }

    await servicio.destroy();
    return true;
};
