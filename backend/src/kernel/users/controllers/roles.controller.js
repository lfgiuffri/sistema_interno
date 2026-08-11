/**
 * Sistema Interno — ABM de roles sobre CAPABILITIES (single-tenant).
 *
 * Un rol es un set de capabilities (`modulo:accion`). El rol Admin (isSystem=true,
 * capability `*`) es intocable: no se edita ni se elimina — es la garantía de que nadie
 * pueda dejar el sistema sin administración (misma regla que el sistema legado).
 * El comodín `*` no es asignable desde la UI: solo lo tiene el rol Admin del seed.
 */

import { matchedData } from "express-validator";
import { Op } from "sequelize";
import slug from "slug";
import { responseManager } from "../../../libs/responseManager.js";
import { getDeclaredCapabilities, getRoleCapabilities, setRoleCapabilities } from '../../capability.js';

/**
 * Agrupa capabilities por módulo (prefijo antes de ':') para la matriz de la UI.
 * @param {string[]} capabilities - Lista plana de capabilities.
 * @returns {Array<{module: string, capabilities: string[]}>} Agrupadas y ordenadas.
 */
const groupCapabilities = (capabilities) => {
    const groups = new Map();
    for (const cap of capabilities) {
        const module = cap.split(':')[0];
        if (!groups.has(module)) groups.set(module, []);
        groups.get(module).push(cap);
    }
    return [...groups.entries()].map(([module, caps]) => ({ module, capabilities: caps.sort() }));
};

/**
 * GET /users/roles/:id — un rol con sus capabilities.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { role, capabilities }.
 */
export const getRole = async (req, res) => {
    try {
        const { id } = matchedData(req);
        const { Role } = req.models;

        const role = await Role.findOne({ where: { id } });
        if (!role) return await responseManager(404, 'Rol no encontrado', req, res, false);

        const capabilities = await getRoleCapabilities(req.models, 'default', role.id);
        return await responseManager(200, { role, capabilities }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * GET /users/roles/create — catálogo de capabilities declaradas, agrupadas por módulo
 * (lo que la pantalla de Roles muestra como matriz de permisos).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { catalog }.
 */
export const getCreate = async (req, res) => {
    try {
        return await responseManager(200, { catalog: groupCapabilities(getDeclaredCapabilities()) }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * GET /users/roles — listado de roles con capabilities y cantidad de usuarios.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { roles } (cada uno con capabilities y usersCount).
 */
export const getRoles = async (req, res) => {
    try {
        const body = matchedData(req);
        const { Role, RoleCapability, User } = req.models;

        let order = ['createdAt', 'DESC'];
        if (body.order && body.order_type) {
            order = [body.order, body.order_type];
        }

        const where = {};
        if (body.name) where.label = { [Op.like]: `%${body.name}%` };

        const roles = await Role.findAll({
            where,
            include: [{ model: RoleCapability }],
            order: [order]
        });

        // Cantidad de usuarios activos por rol (para las protecciones de la UI).
        const shaped = [];
        for (const role of roles) {
            const usersCount = await User.count({ where: { roleId: role.id } });
            shaped.push({
                ...role.toJSON(),
                capabilities: (role.role_capabilities || []).map(rc => rc.capability),
                usersCount
            });
        }

        return await responseManager(200, { roles: shaped }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * POST /users/roles · PUT /users/roles/:id — alta/edición de rol + set de capabilities.
 * @param {import('express').Request} req - Request (body: { label, description?, capabilities[] }).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { role, capabilities }.
 */
export const updateRole = async (req, res) => {
    try {
        const data = matchedData(req);
        const { id, ...body } = data;
        const { Role } = req.models;

        // Validar capabilities: subset del catálogo declarado; el comodín no es asignable.
        const requested = [...new Set(body.capabilities || [])];
        if (requested.includes('*')) {
            return await responseManager(400, 'El permiso total (*) solo lo tiene el rol Administrador', req, res, false);
        }
        const declared = new Set(getDeclaredCapabilities());
        const unknown = requested.filter(c => !declared.has(c));
        if (unknown.length) {
            return await responseManager(400, `Capabilities desconocidas: ${unknown.join(', ')}`, req, res, false);
        }

        // Generar el name automáticamente desde el label.
        if (body.label) body.name = slug(body.label, { lower: true });

        // Unicidad de label entre roles no eliminados.
        const existing = await Role.findOne({
            where: { label: body.label, ...(id && { id: { [Op.not]: id } }) }
        });
        if (existing) {
            return await responseManager(400, 'La etiqueta del rol ya existe', req, res, false);
        }

        let role;
        if (id) {
            role = await Role.findOne({ where: { id } });
            if (!role) return await responseManager(404, "Rol no encontrado", req, res, false);
            if (role.isSystem) {
                return await responseManager(400, 'El rol Administrador no se puede modificar', req, res, false);
            }
            await role.update({ label: body.label, name: body.name, description: body.description ?? role.description });
        } else {
            role = await Role.create({ label: body.label, name: body.name, description: body.description || null });
        }

        const capabilities = await setRoleCapabilities(req.models, 'default', role.id, requested);

        return await responseManager(id ? 200 : 201, { role, capabilities }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * DELETE /users/roles/:id — baja lógica. Protegido: ni el rol Admin ni un rol en uso.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} Mensaje de confirmación.
 */
export const deleteRole = async (req, res) => {
    try {
        const { id } = matchedData(req);
        const { Role, User } = req.models;

        const role = await Role.findOne({ where: { id } });
        if (!role) return await responseManager(404, "Rol no encontrado", req, res, false);
        if (role.isSystem) {
            return await responseManager(400, 'El rol Administrador no se puede eliminar', req, res, false);
        }

        const usersCount = await User.count({ where: { roleId: id } });
        if (usersCount > 0) {
            return await responseManager(409, `No se puede eliminar: hay ${usersCount} usuario(s) con este rol. Asignales otro rol primero.`, req, res, false);
        }

        await Role.destroy({ where: { id } });
        return await responseManager(200, "Rol eliminado", req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};
