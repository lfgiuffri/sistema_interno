/**
 * Service del módulo `clientes` — TODA la lógica y el acceso a datos.
 *
 * Datos COLABORATIVOS (de la empresa): no se filtra por userId. Reglas:
 *  - Unicidad de nombre contra clientes NO eliminados; si existe uno eliminado homónimo
 *    se ofrece reactivarlo (409 con `deletedId`).
 *  - Un cliente con abonos O proyectos (no eliminados) no se elimina — el legado solo
 *    miraba abonos (bug #11 del análisis); acá la protección es completa y se activa
 *    sola cuando esos módulos existan (guard por presencia del modelo).
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
 * Valida unicidad de nombre; si hay un cliente ELIMINADO homónimo, propone reactivarlo.
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre a validar.
 * @param {number|null} excludeId - Id a excluir (edición).
 * @returns {Promise<void>}
 * @throws {Error} 400 si ya existe; 409 (EXISTE_ELIMINADO) si hay uno eliminado.
 */
const checkNombreUnico = async (models, nombre, excludeId = null) => {
    const { Cliente } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};

    const vivo = await Cliente.findOne({ where: { nombre, ...idClause } });
    if (vivo) throw bizError(400, 'Ya existe un cliente con ese nombre');

    const eliminado = await Cliente.findOne({ where: { nombre, ...idClause }, paranoid: false });
    if (eliminado && eliminado.deletedAt) {
        throw bizError(409, `Ya existió un cliente llamado «${nombre}» (eliminado). Podés reactivarlo.`, {
            errorCode: 'EXISTE_ELIMINADO',
            deletedId: eliminado.id
        });
    }
};

/**
 * Lista clientes con paginación, búsqueda (nombre/contacto/email) y filtro de activo.
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - { page, limit, search, activo }.
 * @returns {Promise<{rows: object[], count: number, page: number, limit: number}>}
 */
export const listClientes = async (models, query = {}) => {
    const { Cliente, Abono } = models;
    const where = {};
    if (query.search) {
        where[Op.or] = [
            { nombre: { [Op.like]: `%${query.search}%` } },
            { contacto: { [Op.like]: `%${query.search}%` } },
            { email: { [Op.like]: `%${query.search}%` } }
        ];
    }
    if (query.activo !== undefined && query.activo !== '') where.activo = query.activo === 'true' || query.activo === true;

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 200);

    const { rows, count } = await Cliente.findAndCountAll({
        where,
        limit,
        offset: (page - 1) * limit,
        order: [['nombre', 'ASC']],
        distinct: true
    });

    // Conteo de abonos por cliente en UNA query (cuando el módulo exista).
    let abonosPorCliente = {};
    if (Abono && rows.length) {
        const counts = await Abono.findAll({
            attributes: ['clienteId', [Abono.sequelize.fn('COUNT', Abono.sequelize.col('id')), 'n']],
            where: { clienteId: { [Op.in]: rows.map(c => c.id) } },
            group: ['clienteId'],
            raw: true
        });
        abonosPorCliente = Object.fromEntries(counts.map(c => [c.clienteId, Number(c.n)]));
    }

    const shaped = rows.map(c => ({ ...c.toJSON(), abonosCount: abonosPorCliente[c.id] || 0 }));
    return { rows: shaped, count, page, limit };
};

/**
 * Un cliente por id.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del cliente.
 * @returns {Promise<object|null>} El cliente o null.
 */
export const getCliente = (models, id) => models.Cliente.findByPk(id);

/**
 * Crea un cliente (valida unicidad + reactivación).
 * @param {object} models - Modelos de la app.
 * @param {object} data - { nombre, contacto?, email?, telefono?, observaciones?, activo? }.
 * @returns {Promise<object>} El cliente creado.
 */
export const createCliente = async (models, data) => {
    await checkNombreUnico(models, data.nombre);
    return models.Cliente.create(data);
};

/**
 * Actualiza un cliente.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id a editar.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} El cliente actualizado o null.
 */
export const updateCliente = async (models, id, data) => {
    const cliente = await models.Cliente.findByPk(id);
    if (!cliente) return null;
    if (data.nombre && data.nombre !== cliente.nombre) {
        await checkNombreUnico(models, data.nombre, id);
    }
    await cliente.update(data);
    return cliente;
};

/**
 * Alterna el estado activo.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del cliente.
 * @returns {Promise<object|null>} El cliente actualizado o null.
 */
export const toggleCliente = async (models, id) => {
    const cliente = await models.Cliente.findByPk(id);
    if (!cliente) return null;
    await cliente.update({ activo: !cliente.activo });
    return cliente;
};

/**
 * Reactiva un cliente eliminado.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del cliente eliminado.
 * @returns {Promise<object|null>} El cliente restaurado o null.
 */
export const restoreCliente = async (models, id) => {
    const { Cliente } = models;
    const cliente = await Cliente.findByPk(id, { paranoid: false });
    if (!cliente || !cliente.deletedAt) return null;

    const vivo = await Cliente.findOne({ where: { nombre: cliente.nombre } });
    if (vivo) throw bizError(400, 'Ya existe un cliente activo con ese nombre; renombralo primero');

    await cliente.restore();
    return cliente;
};

/**
 * Elimina (soft) un cliente. Protección: abonos Y proyectos (no eliminados).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del cliente.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si está en uso.
 */
export const deleteCliente = async (models, id) => {
    const { Cliente, Abono, Proyecto } = models;
    const cliente = await Cliente.findByPk(id);
    if (!cliente) return false;

    const partes = [];
    if (Abono) {
        const n = await Abono.count({ where: { clienteId: id } });
        if (n > 0) partes.push(`${n} abono(s)`);
    }
    if (Proyecto) {
        const n = await Proyecto.count({ where: { clienteId: id } });
        if (n > 0) partes.push(`${n} proyecto(s)`);
    }
    if (partes.length) {
        throw bizError(409, `No se puede eliminar: el cliente tiene ${partes.join(' y ')}. Eliminá o reasigná eso primero.`);
    }

    await cliente.destroy();
    return true;
};
