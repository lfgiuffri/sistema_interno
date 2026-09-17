/**
 * ABM de los usuarios de PORTAL de un cliente, desde el sistema interno.
 *
 * No hay auto-registro: las cuentas las crea y las resetea un usuario interno, igual que las
 * del sistema interno («sin signup público — los usuarios los crea un administrador»). Eso
 * elimina de entrada el flujo de recuperación de contraseña, que es donde suele vivir la
 * enumeración de usuarios en una superficie expuesta a internet.
 */

import { Op } from 'sequelize';
import { hashPassword } from '../../../kernel/auth/password.js';

/**
 * Error de negocio con status.
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje.
 * @returns {Error} Error enriquecido.
 */
const bizError = (statusCode, message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

/** Campos que se devuelven de un usuario de portal (nunca el hash). */
const CAMPOS = ['id', 'clienteId', 'nombre', 'email', 'activo', 'ultimoAccesoAt', 'createdAt'];

/**
 * El email no puede repetirse entre usuarios de portal vivos: es la credencial de login.
 * @param {object} models - Modelos de la app.
 * @param {string} email - Email normalizado.
 * @param {number|null} [excluirId] - Usuario que se está editando.
 * @returns {Promise<void>}
 * @throws {Error} 400 si ya existe.
 */
const checkEmailUnico = async (models, email, excluirId = null) => {
    const where = { email };
    if (excluirId) where.id = { [Op.ne]: excluirId };
    if (await models.ClienteUsuario.findOne({ where })) {
        throw bizError(400, 'Ya hay un usuario de portal con ese email');
    }
};

/**
 * Usuarios de portal de un cliente.
 * @param {object} models - Modelos de la app.
 * @param {number} clienteId - Cliente.
 * @returns {Promise<object[]>} Usuarios, sin el hash.
 */
export const listClienteUsuarios = async (models, clienteId) =>
    models.ClienteUsuario.findAll({
        where: { clienteId: Number(clienteId) },
        attributes: CAMPOS,
        order: [['nombre', 'ASC']],
        raw: true
    });

/**
 * Crea un usuario de portal.
 * @param {object} models - Modelos de la app.
 * @param {number} clienteId - Cliente.
 * @param {{nombre: string, email: string, password: string}} data - Datos.
 * @returns {Promise<object>} El usuario creado (sin el hash).
 * @throws {Error} 404 si el cliente no existe; 400 si el email se repite.
 */
export const createClienteUsuario = async (models, clienteId, data) => {
    const { ClienteUsuario, Cliente } = models;
    const cliente = await Cliente.findByPk(Number(clienteId));
    if (!cliente) throw bizError(404, 'Cliente no encontrado');

    const email = String(data.email).trim().toLowerCase();
    await checkEmailUnico(models, email);

    const usuario = await ClienteUsuario.create({
        clienteId: cliente.id,
        nombre: String(data.nombre).trim(),
        email,
        // Hashear ANTES del create: nunca una contraseña en claro en la base.
        password: await hashPassword(data.password),
        activo: true
    });
    return ClienteUsuario.findByPk(usuario.id, { attributes: CAMPOS, raw: true });
};

/**
 * Edita un usuario de portal. La contraseña se cambia mandándola; omitirla la deja como está.
 * @param {object} models - Modelos de la app.
 * @param {number} clienteId - Cliente (acota: un id de otro cliente no se toca).
 * @param {number} id - Usuario.
 * @param {object} data - { nombre?, email?, password? }.
 * @returns {Promise<object|null>} El usuario actualizado, o null si no existe.
 */
export const updateClienteUsuario = async (models, clienteId, id, data) => {
    const { ClienteUsuario } = models;
    const usuario = await ClienteUsuario.findOne({ where: { id: Number(id), clienteId: Number(clienteId) } });
    if (!usuario) return null;

    const patch = {};
    if (data.nombre !== undefined) patch.nombre = String(data.nombre).trim();
    if (data.email !== undefined) {
        patch.email = String(data.email).trim().toLowerCase();
        await checkEmailUnico(models, patch.email, usuario.id);
    }
    // Resetear la contraseña es exactamente esto: mandarla. No hay flujo por mail.
    if (data.password) patch.password = await hashPassword(data.password);

    await usuario.update(patch);
    return ClienteUsuario.findByPk(usuario.id, { attributes: CAMPOS, raw: true });
};

/**
 * Activa o desactiva un usuario de portal. Desactivar corta el acceso de inmediato: el
 * middleware relee la fila en cada request, no espera a que expire el token.
 * @param {object} models - Modelos de la app.
 * @param {number} clienteId - Cliente.
 * @param {number} id - Usuario.
 * @returns {Promise<object|null>} El usuario, o null si no existe.
 */
export const toggleClienteUsuario = async (models, clienteId, id) => {
    const { ClienteUsuario } = models;
    const usuario = await ClienteUsuario.findOne({ where: { id: Number(id), clienteId: Number(clienteId) } });
    if (!usuario) return null;
    await usuario.update({ activo: !usuario.activo });
    return ClienteUsuario.findByPk(usuario.id, { attributes: CAMPOS, raw: true });
};

/**
 * Elimina (soft) un usuario de portal.
 * @param {object} models - Modelos de la app.
 * @param {number} clienteId - Cliente.
 * @param {number} id - Usuario.
 * @returns {Promise<boolean>} true si se eliminó.
 */
export const deleteClienteUsuario = async (models, clienteId, id) => {
    const usuario = await models.ClienteUsuario.findOne({
        where: { id: Number(id), clienteId: Number(clienteId) }
    });
    if (!usuario) return false;
    await usuario.destroy();
    return true;
};
