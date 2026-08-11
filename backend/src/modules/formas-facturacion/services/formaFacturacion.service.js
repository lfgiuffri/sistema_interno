/**
 * Service del módulo `formas-facturacion` — TODA la lógica y el acceso a datos.
 *
 * Reglas: unicidad de nombre (el legado no la tenía) con oferta de reactivación, y
 * protección de borrado si está en uso por abonos (el legado la borraba igual —
 * bug #12 del análisis). El guard se activa solo cuando exista el módulo de abonos.
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
 * Valida unicidad de nombre; si hay una eliminada homónima, propone reactivarla.
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre a validar.
 * @param {number|null} excludeId - Id a excluir (edición).
 * @returns {Promise<void>}
 * @throws {Error} 400 si ya existe; 409 (EXISTE_ELIMINADO) si hay una eliminada.
 */
const checkNombreUnico = async (models, nombre, excludeId = null) => {
    const { FormaFacturacion } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};

    const vivo = await FormaFacturacion.findOne({ where: { nombre, ...idClause } });
    if (vivo) throw bizError(400, 'Ya existe una forma de facturación con ese nombre');

    const eliminado = await FormaFacturacion.findOne({ where: { nombre, ...idClause }, paranoid: false });
    if (eliminado && eliminado.deletedAt) {
        throw bizError(409, `Ya existió una forma de facturación llamada «${nombre}» (eliminada). Podés reactivarla.`, {
            errorCode: 'EXISTE_ELIMINADO',
            deletedId: eliminado.id
        });
    }
};

/**
 * Lista formas de facturación con paginación, búsqueda y filtro de activo.
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - { page, limit, search, activo }.
 * @returns {Promise<{rows: object[], count: number, page: number, limit: number}>}
 */
export const listFormas = async (models, query = {}) => {
    const { FormaFacturacion, Abono } = models;
    const where = {};
    if (query.search) where.nombre = { [Op.like]: `%${query.search}%` };
    if (query.activo !== undefined && query.activo !== '') where.activo = query.activo === 'true' || query.activo === true;

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);

    const { rows, count } = await FormaFacturacion.findAndCountAll({
        where,
        limit,
        offset: (page - 1) * limit,
        order: [['activo', 'DESC'], ['nombre', 'ASC']],
        distinct: true
    });

    // Conteo de abonos por forma en UNA query (cuando el módulo exista).
    let abonosPorForma = {};
    if (Abono && rows.length) {
        const counts = await Abono.findAll({
            attributes: ['formaFacturacionId', [Abono.sequelize.fn('COUNT', Abono.sequelize.col('id')), 'n']],
            where: { formaFacturacionId: { [Op.in]: rows.map(f => f.id) } },
            group: ['formaFacturacionId'],
            raw: true
        });
        abonosPorForma = Object.fromEntries(counts.map(c => [c.formaFacturacionId, Number(c.n)]));
    }

    const shaped = rows.map(f => ({ ...f.toJSON(), abonosCount: abonosPorForma[f.id] || 0 }));
    return { rows: shaped, count, page, limit };
};

/**
 * Una forma de facturación por id.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id.
 * @returns {Promise<object|null>} La forma o null.
 */
export const getForma = (models, id) => models.FormaFacturacion.findByPk(id);

/**
 * Crea una forma de facturación (unicidad + reactivación).
 * @param {object} models - Modelos de la app.
 * @param {object} data - { nombre, activo? }.
 * @returns {Promise<object>} La forma creada.
 */
export const createForma = async (models, data) => {
    await checkNombreUnico(models, data.nombre);
    return models.FormaFacturacion.create(data);
};

/**
 * Actualiza una forma de facturación.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id a editar.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} La forma actualizada o null.
 */
export const updateForma = async (models, id, data) => {
    const forma = await models.FormaFacturacion.findByPk(id);
    if (!forma) return null;
    if (data.nombre && data.nombre !== forma.nombre) {
        await checkNombreUnico(models, data.nombre, id);
    }
    await forma.update(data);
    return forma;
};

/**
 * Alterna el estado activo.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id.
 * @returns {Promise<object|null>} La forma actualizada o null.
 */
export const toggleForma = async (models, id) => {
    const forma = await models.FormaFacturacion.findByPk(id);
    if (!forma) return null;
    await forma.update({ activo: !forma.activo });
    return forma;
};

/**
 * Reactiva una forma eliminada.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id de la forma eliminada.
 * @returns {Promise<object|null>} La forma restaurada o null.
 */
export const restoreForma = async (models, id) => {
    const { FormaFacturacion } = models;
    const forma = await FormaFacturacion.findByPk(id, { paranoid: false });
    if (!forma || !forma.deletedAt) return null;

    const vivo = await FormaFacturacion.findOne({ where: { nombre: forma.nombre } });
    if (vivo) throw bizError(400, 'Ya existe una forma de facturación activa con ese nombre; renombrala primero');

    await forma.restore();
    return forma;
};

/**
 * Elimina (soft) una forma. Protección: abonos que la usan (no eliminados).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si está en uso.
 */
export const deleteForma = async (models, id) => {
    const { FormaFacturacion, Abono } = models;
    const forma = await FormaFacturacion.findByPk(id);
    if (!forma) return false;

    if (Abono) {
        const n = await Abono.count({ where: { formaFacturacionId: id } });
        if (n > 0) {
            throw bizError(409, `No se puede eliminar: hay ${n} abono(s) con esta forma de facturación. Reasignalos primero.`);
        }
    }

    await forma.destroy();
    return true;
};
