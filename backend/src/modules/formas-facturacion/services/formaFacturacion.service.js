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
 *
 * Cada fila suma `abonosCount` (todos sus abonos), `abonosActivos` y los totales `totalArs` /
 * `totalUsd` de los ACTIVOS, cada moneda en la suya. Todo sale de UNA consulta agrupada.
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

    // Conteo y totales de abonos por forma en UNA query (cuando el módulo exista).
    //
    // Se agrupa por forma Y MONEDA, y cada una se suma en la suya: un abono es ARS o USD, así
    // que sumar las dos juntas daría un número que no es plata de ninguna parte. Convertir
    // todo a pesos con la cotización escondería la composición —«esta forma factura US$ 1.200»
    // es justamente el dato que se quiere ver— y el total convertido siempre se puede sacar
    // después a partir de estos dos.
    //
    // Los TOTALES cuentan solo los abonos ACTIVOS: uno pausado no se factura y meterlo en la
    // suma sería inflar la cifra. `abonosCount` sigue contando todos, como hasta ahora, así
    // que se devuelve además `abonosActivos` para que los números se puedan reconciliar: sin
    // eso, una forma con 12 abonos y un total que cubre 9 parece un error.
    const porForma = {};
    if (Abono && rows.length) {
        const { fn, col } = Abono.sequelize;
        const filas = await Abono.findAll({
            attributes: [
                'formaFacturacionId', 'moneda', 'activo',
                [fn('COUNT', col('id')), 'n'],
                [fn('SUM', col('precio')), 'total'],
            ],
            where: { formaFacturacionId: { [Op.in]: rows.map(f => f.id) } },
            group: ['formaFacturacionId', 'moneda', 'activo'],
            raw: true
        });
        for (const r of filas) {
            const acc = porForma[r.formaFacturacionId] ??= { abonosCount: 0, abonosActivos: 0, totalArs: 0, totalUsd: 0 };
            acc.abonosCount += Number(r.n);
            if (!r.activo) continue;
            acc.abonosActivos += Number(r.n);
            if (r.moneda === 'USD') acc.totalUsd += Number(r.total);
            else acc.totalArs += Number(r.total);
        }
    }

    const vacio = { abonosCount: 0, abonosActivos: 0, totalArs: 0, totalUsd: 0 };
    const shaped = rows.map(f => ({ ...f.toJSON(), ...vacio, ...(porForma[f.id] ?? {}) }));
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
