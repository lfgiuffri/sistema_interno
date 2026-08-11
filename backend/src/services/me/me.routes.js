/**
 * Sistema Interno — Endpoint de contexto de sesión: GET /me.
 *
 * Devuelve al frontend todo lo que necesita para armar la UI permission-aware: el usuario,
 * los MÓDULOS cargados y las CAPABILITIES de su rol. Con esto el shell construye el menú
 * dinámico y oculta/gatea acciones sin hardcodear nada.
 */

import { Router } from 'express';
import { responseManager } from '../../libs/responseManager.js';
import { getRoleCapabilities, getDeclaredCapabilities } from '../../kernel/index.js';
import { getLoadedModules } from '../../kernel/moduleLoader.js';

const router = Router();

/**
 * GET /me — contexto de sesión del usuario autenticado.
 * @param {import('express').Request} req - Request (req.user, req.models).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { user, modules, capabilities, declaredCapabilities }.
 */
router.get('/', async (req, res) => {
    try {
        // Capabilities del rol del usuario (para gatear acciones en la UI).
        const capabilities = await getRoleCapabilities(req.models, 'default', req.user.roleId);

        const data = {
            user: {
                id: req.user.id,
                name: req.user.name,
                lastName: req.user.lastName,
                email: req.user.email,
                username: req.user.username,
                roleId: req.user.roleId,
                role: req.user.role ? { id: req.user.role.id, label: req.user.role.label } : null,
                avatar: req.user.avatar,
                mfaEnabled: !!req.user.mfaEnabled
            },
            // Módulos feature cargados (key + nombre): el menú se arma cruzando esto
            // con las capabilities de lectura del usuario.
            modules: getLoadedModules().map(m => ({ key: m.key, name: m.name, basePath: m.basePath })),
            capabilities,
            // Catálogo completo declarado (lo usa la pantalla de Roles para armar la matriz).
            declaredCapabilities: getDeclaredCapabilities()
        };
        return await responseManager(200, data, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
});

export default router;
