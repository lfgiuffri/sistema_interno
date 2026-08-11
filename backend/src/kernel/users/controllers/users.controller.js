/**
 * Sistema Interno — ABM de usuarios (single-tenant).
 *
 * Protecciones (del PRD, algunas ausentes en el sistema legado):
 *  - Unicidad de username y email contra usuarios NO eliminados.
 *  - Nadie puede desactivarse, eliminarse ni cambiarse el rol a sí mismo.
 *  - El ÚLTIMO administrador activo no se puede desactivar, eliminar ni degradar
 *    (evita el lockout total del sistema).
 *  - El password se hashea ANTES de crear (nunca se persiste en texto plano).
 */

import { matchedData } from "express-validator";
import { Op } from "sequelize";
import Paginate from '../../../libs/paginate.js';
import { responseManager } from "../../../libs/responseManager.js";
import { hashPassword } from '../../auth/password.js';

/** Include estándar del rol para las respuestas de usuario. */
const roleInclude = (Role) => [{ model: Role, foreignKey: 'roleId' }];

/**
 * ¿El rol es de administrador? (tiene la capability comodín `*`).
 * @param {object} models - Modelos de la app.
 * @param {number} roleId - Rol a consultar.
 * @returns {Promise<boolean>} true si es rol admin.
 */
const isAdminRole = async (models, roleId) => {
    if (!models.RoleCapability || roleId == null) return false;
    const row = await models.RoleCapability.findOne({ where: { roleId, capability: '*' } });
    return !!row;
};

/**
 * ¿La operación dejaría al sistema sin administradores activos?
 * Se considera admin a todo usuario activo (no eliminado) cuyo rol tenga la capability `*`.
 * @param {object} models - Modelos de la app.
 * @param {number} excludeUserId - Usuario que se va a desactivar/eliminar/degradar.
 * @returns {Promise<boolean>} true si NO quedaría ningún otro admin activo.
 */
const wouldRemoveLastAdmin = async (models, excludeUserId) => {
    const { User, RoleCapability } = models;
    if (!RoleCapability) return false;
    const adminRoles = await RoleCapability.findAll({ where: { capability: '*' }, attributes: ['roleId'] });
    const adminRoleIds = adminRoles.map(r => r.roleId);
    if (!adminRoleIds.length) return false;
    const others = await User.count({
        where: { roleId: { [Op.in]: adminRoleIds }, active: true, id: { [Op.ne]: excludeUserId } }
    });
    return others === 0;
};

/**
 * Valida unicidad de username/email contra usuarios no eliminados (excluyendo al propio).
 * @param {object} models - Modelos de la app.
 * @param {object} body - Datos a validar ({ username?, email? }).
 * @param {number|null} excludeId - Id a excluir (edición) o null (alta).
 * @returns {Promise<string|null>} Mensaje de error o null si es único.
 */
const checkUniqueness = async (models, body, excludeId = null) => {
    const { User } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};
    if (body.username) {
        const exists = await User.findOne({ where: { username: body.username, ...idClause } });
        if (exists) return 'Ya existe un usuario con ese nombre de usuario';
    }
    if (body.email) {
        const exists = await User.findOne({ where: { email: body.email, ...idClause } });
        if (exists) return 'Ya existe un usuario con ese email';
    }
    return null;
};

/**
 * GET /users/my-account — el usuario logueado con su rol.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { user }.
 */
export const getMyAccount = async (req, res) => {
    try {
        const { User, Role } = req.models;
        const user = await User.findOne({
            where: { id: req.user.id },
            attributes: { exclude: ['password', 'mfaSecret', 'mfaBackupCodes'] },
            include: roleInclude(Role)
        });
        if (!user) {
            return await responseManager(404, 'Usuario no encontrado', req, res, false);
        }
        return await responseManager(200, { user }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * GET /users/:id — un usuario por id.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} El usuario (sin campos sensibles).
 */
export const getUser = async (req, res) => {
    try {
        const body = matchedData(req);
        const { User, Role } = req.models;

        const user = await User.findOne({
            where: { id: body.id },
            include: roleInclude(Role),
            attributes: { exclude: ['password', 'mfaSecret', 'mfaBackupCodes'] }
        });
        if (!user) {
            return await responseManager(404, 'Usuario no encontrado', req, res, false);
        }
        return await responseManager(200, user, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * GET /users — listado paginado con búsqueda por nombre/apellido/email/username.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { users, paginate }.
 */
export const getUsers = async (req, res) => {
    try {
        const body = matchedData(req);
        const { User, Role } = req.models;

        const limit = body.limit ? parseInt(body.limit) : 30;
        const page = body.page ? parseInt(body.page) : 1;
        let order = ['id', 'DESC'];
        if (body.order && body.order_type) {
            order = [body.order, body.order_type];
        }

        // Búsqueda multi-palabra: cada palabra debe matchear en alguno de los campos.
        const arrWhereAnd = [];
        if (body.search) {
            const keysSearch = ["name", "lastName", "email", "username"];
            for (const word of body.search.split(" ")) {
                arrWhereAnd.push({
                    [Op.or]: keysSearch.map(key => ({ [key]: { [Op.like]: `%${word}%` } }))
                });
            }
        }
        const where = arrWhereAnd.length ? { [Op.and]: arrWhereAnd } : {};

        const users = await User.findAll({
            where,
            include: roleInclude(Role),
            attributes: { exclude: ['password', 'mfaSecret', 'mfaBackupCodes'] },
            limit,
            offset: limit * (page - 1),
            order: [order]
        });

        const totalItems = await User.count({ where, distinct: true });
        const paginate = Paginate(totalItems, limit, page);

        return await responseManager(200, { users, paginate }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * POST /users · PUT /users/:id — alta y edición de usuarios.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} El usuario creado/actualizado.
 */
export const createUpdateUser = async (req, res) => {
    try {
        const data = matchedData(req);
        const { id, ...body } = data;
        const { User, Role } = req.models;

        const role = await Role.findOne({ where: { id: body.roleId } });
        if (!role) {
            return await responseManager(404, 'Rol no encontrado', req, res, false);
        }
        body.roleId = role.id;

        const uniqueError = await checkUniqueness(req.models, body, id || null);
        if (uniqueError) {
            return await responseManager(400, uniqueError, req, res, false);
        }

        let user;
        if (id) {
            // ── UPDATE ──
            user = await User.findOne({ where: { id } });
            if (!user) {
                return await responseManager(404, 'Usuario no encontrado', req, res, false);
            }

            const isSelf = Number(id) === Number(req.user.id);
            if (isSelf && Number(body.roleId) !== Number(user.roleId)) {
                return await responseManager(400, 'No podés cambiar tu propio rol', req, res, false);
            }
            if (isSelf && body.active === false) {
                return await responseManager(400, 'No podés desactivar tu propio usuario', req, res, false);
            }

            // Último admin: no se puede degradar ni desactivar.
            const changesRole = Number(body.roleId) !== Number(user.roleId);
            const deactivates = body.active === false && user.active;
            if ((changesRole || deactivates) && await isAdminRole(req.models, user.roleId)) {
                const losesAdmin = deactivates || !(await isAdminRole(req.models, body.roleId));
                if (losesAdmin && await wouldRemoveLastAdmin(req.models, user.id)) {
                    return await responseManager(400, 'No se puede quitar al último administrador activo del sistema', req, res, false);
                }
            }

            if (body.password && body.password.trim() !== '') {
                body.password = await hashPassword(body.password);
            } else {
                delete body.password; // sin password nuevo → se conserva el actual
            }

            await User.update(body, { where: { id } });
            user = await User.findOne({ where: { id } });
        } else {
            // ── CREATE ── El hash se calcula ANTES del create: nunca persistir texto plano.
            if (!body.password || body.password.trim() === '') {
                return await responseManager(400, 'La contraseña es obligatoria', req, res, false);
            }
            body.password = await hashPassword(body.password);
            user = await User.create(body);
        }

        user = await User.findOne({
            where: { id: user.id },
            include: roleInclude(Role),
            attributes: { exclude: ['password', 'mfaSecret', 'mfaBackupCodes'] }
        });

        return await responseManager(id ? 200 : 201, user, req, res, false);
    } catch (error) {
        return await responseManager(400, error.message, req, res, true);
    }
};

/**
 * PUT /users/my-account — el usuario logueado edita SU PROPIO perfil.
 * Sin capability: es la cuenta propia. Campos restringidos a lo personal
 * (nombre, apellido, email, avatar y contraseña) — el rol, el username y el
 * estado activo solo se tocan desde el ABM de usuarios (con capability).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} El usuario actualizado.
 */
export const updateMyAccount = async (req, res) => {
    try {
        const data = matchedData(req);
        const { User, Role } = req.models;

        const user = await User.findByPk(req.user.id);
        if (!user) return await responseManager(404, 'Usuario no encontrado', req, res, false);

        // Whitelist explícita: nada de roleId/active/username por esta vía.
        const body = {};
        if (data.name !== undefined) body.name = data.name;
        if (data.lastName !== undefined) body.lastName = data.lastName;
        if (data.email !== undefined) body.email = data.email;
        if (data.avatar !== undefined) body.avatar = data.avatar;
        if (data.avatarColor !== undefined) body.avatarColor = data.avatarColor;

        if (body.email) {
            const uniqueError = await checkUniqueness(req.models, { email: body.email }, user.id);
            if (uniqueError) return await responseManager(400, uniqueError, req, res, false);
        }

        if (data.password && data.password.trim() !== '') {
            body.password = await hashPassword(data.password);
        }

        await user.update(body);
        const fresh = await User.findOne({
            where: { id: user.id },
            include: roleInclude(Role),
            attributes: { exclude: ['password', 'mfaSecret', 'mfaBackupCodes'] }
        });
        return await responseManager(200, fresh, req, res, false);
    } catch (error) {
        return await responseManager(400, error.message, req, res, true);
    }
};

/**
 * PATCH /users/:id/active — activa/desactiva un usuario (toggle).
 * Un usuario desactivado pierde la sesión en el próximo request (verifyAccessToken revalida).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} El usuario actualizado.
 */
export const toggleActive = async (req, res) => {
    try {
        const { id } = matchedData(req);
        const { User, Role } = req.models;

        if (Number(id) === Number(req.user.id)) {
            return await responseManager(400, 'No podés desactivar tu propio usuario', req, res, false);
        }

        const user = await User.findOne({ where: { id } });
        if (!user) {
            return await responseManager(404, 'Usuario no encontrado', req, res, false);
        }

        // Desactivar al último admin activo dejaría el sistema sin administración.
        if (user.active && await isAdminRole(req.models, user.roleId)
            && await wouldRemoveLastAdmin(req.models, user.id)) {
            return await responseManager(400, 'No se puede desactivar al último administrador activo del sistema', req, res, false);
        }

        await user.update({ active: !user.active });
        const fresh = await User.findOne({
            where: { id },
            include: roleInclude(Role),
            attributes: { exclude: ['password', 'mfaSecret', 'mfaBackupCodes'] }
        });
        return await responseManager(200, fresh, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * DELETE /users/:id — baja lógica (paranoid).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} Mensaje de confirmación.
 */
export const deleteUser = async (req, res) => {
    try {
        const { id } = matchedData(req);
        const { User } = req.models;

        if (Number(id) === Number(req.user.id)) {
            return await responseManager(400, 'No podés eliminar tu propio usuario', req, res, false);
        }

        const user = await User.findOne({ where: { id } });
        if (!user) {
            return await responseManager(404, 'Usuario no encontrado', req, res, false);
        }

        if (user.active && await isAdminRole(req.models, user.roleId)
            && await wouldRemoveLastAdmin(req.models, user.id)) {
            return await responseManager(400, 'No se puede eliminar al último administrador activo del sistema', req, res, false);
        }

        await user.destroy();
        return await responseManager(200, { message: "Usuario eliminado" }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};
