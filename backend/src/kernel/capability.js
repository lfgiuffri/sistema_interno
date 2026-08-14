/**
 * Sistema Interno — Micro-permisos por capability.
 *
 * Cada ruta de un módulo declara la capability que requiere (ej. `items:create`).
 * `requireCapability(cap)` corre DESPUÉS de verifyAccessToken (ya hay req.user) y
 * autoriza según las capabilities del ROL del usuario, guardadas en la tabla
 * RoleCapability del tenant. La capability `*` es comodín (rol admin = todo).
 *
 * Las capabilities disponibles las DECLARAN los módulos en su manifest (registerCapabilities);
 * la ASIGNACIÓN a roles vive en RoleCapability y se gestiona desde el admin (M10) o el seed
 * de tenant. Deny-by-default: si el rol no tiene la capability (ni `*`), se deniega.
 */

import { cacheGet, cacheSet, cacheDel } from '../config/redis.js';
import { responseManager } from '../libs/responseManager.js';

/** TTL del cache de capabilities por rol (segundos). */
const CAP_CACHE_TTL = 300;

/** Capability comodín: el rol que la tiene puede ejecutar cualquier acción. */
const WILDCARD = '*';

// ─── Catálogo de capabilities declaradas (llenado por los manifests al boot) ────
const declaredCapabilities = new Set();

/**
 * Registra capabilities declaradas por un módulo (vía su manifest).
 * @param {string[]} caps - Lista de capabilities (ej. ['items:read','items:create']).
 * @returns {void}
 */
export const registerCapabilities = (caps = []) => {
    for (const c of caps) declaredCapabilities.add(c);
};

/**
 * Devuelve todas las capabilities declaradas en el sistema (para seed de roles / admin UI).
 * @returns {string[]} Lista ordenada de capabilities.
 */
export const getDeclaredCapabilities = () => [...declaredCapabilities].sort();

// ─── Resolución de capabilities de un rol ──────────────────────────────────────

/**
 * Decide si un set de capabilities cubre la requerida (match exacto o comodín `*`).
 * Función pura → fácil de testear en aislamiento.
 * @param {string[]} caps - Capabilities del rol.
 * @param {string} cap - Capability requerida por la ruta.
 * @returns {boolean} true si el rol puede.
 */
export const roleHasCapability = (caps, cap) => caps.includes(WILDCARD) || caps.includes(cap);

/**
 * Devuelve las capabilities de un rol (cacheadas en Redis 5 min, igual que verifyPermissions).
 * @param {object} models - Modelos del tenant (req.models).
 * @param {number|string} tenantId - ID del tenant (para namespacing del cache).
 * @param {number} roleId - Rol del usuario.
 * @returns {Promise<string[]>} Capabilities del rol (puede ser []).
 */
export const getRoleCapabilities = async (models, tenantId, roleId) => {
    const cacheKey = `caps:${tenantId}:${roleId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    let caps = [];
    // Si el tenant aún no tiene el modelo (provisión vieja), degradamos a [] (deny-by-default).
    if (models?.RoleCapability && roleId != null) {
        const rows = await models.RoleCapability.findAll({ where: { roleId }, attributes: ['capability'] });
        caps = rows.map(r => r.capability);
    }
    await cacheSet(cacheKey, caps, CAP_CACHE_TTL);
    return caps;
};

/**
 * Invalida el cache de capabilities de un rol (llamar tras modificar sus permisos).
 * @param {number|string} tenantId - ID del tenant.
 * @param {number} roleId - Rol afectado.
 * @returns {Promise<void>}
 */
export const invalidateRoleCapabilities = async (tenantId, roleId) => {
    await cacheDel(`caps:${tenantId}:${roleId}`);
};

/**
 * Reemplaza el set completo de capabilities de un rol (usado por el admin y el seed).
 * @param {object} models - Modelos del tenant.
 * @param {number|string} tenantId - ID del tenant (para invalidar cache).
 * @param {number} roleId - Rol a configurar.
 * @param {string[]} capabilities - Nuevo set de capabilities.
 * @returns {Promise<string[]>} El set único aplicado.
 */
export const setRoleCapabilities = async (models, tenantId, roleId, capabilities = []) => {
    // Borrado físico del set anterior + alta del nuevo (idempotente, simple de razonar).
    await models.RoleCapability.destroy({ where: { roleId }, force: true });
    const unique = [...new Set(capabilities)];
    if (unique.length) {
        await models.RoleCapability.bulkCreate(unique.map(capability => ({ roleId, capability })));
    }
    await invalidateRoleCapabilities(tenantId, roleId);
    return unique;
};

/**
 * Otorga TODAS las capabilities a un rol asignándole el comodín `*` (rol admin del tenant).
 * Se usa al provisionar un tenant para que su rol admin pueda todo desde el arranque.
 * @param {object} models - Modelos del tenant.
 * @param {number|string} tenantId - ID del tenant.
 * @param {number} roleId - Rol admin del tenant.
 * @returns {Promise<string[]>} `['*']`.
 */
export const grantAllCapabilities = async (models, tenantId, roleId) =>
    setRoleCapabilities(models, tenantId, roleId, [WILDCARD]);

// ─── Middleware ────────────────────────────────────────────────────────────────

/**
 * Middleware que exige una capability para acceder a una ruta. Deny-by-default.
 * @param {string} cap - Capability requerida (ej. 'items:update').
 * @returns {import('express').RequestHandler} Middleware Express (async).
 */
export const requireCapability = (cap) => async (req, res, next) => {
    try {
        // Dejamos rastro de la capability pedida (útil para auditoría / debugging).
        req.requiredCapability = cap;

        if (!req.user) {
            return await responseManager(401, 'No autenticado', req, res, false);
        }

        const tenantId = req.tenant?.id || 'default';
        const caps = await getRoleCapabilities(req.models, tenantId, req.user.roleId);

        if (roleHasCapability(caps, cap)) return next();

        // Sin la capability (ni comodín) → 403. Incluimos la capability faltante para claridad.
        return await responseManager(403, `No tenés el permiso requerido: ${cap}`, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};
