/**
 * Middleware de autenticación del PORTAL DE CLIENTES.
 *
 * Hermano de `middlewares/verifyAccessToken.js`, no una variante: aquel tiene `User` y `Role`
 * hardcodeados y pone una instancia de `User` en `req.user`.
 *
 * ⚠️ El principal va en **`req.clienteUsuario`, nunca en `req.user`**. No es cosmético:
 * `requireCapability` (`kernel/capability.js`) resuelve permisos con `req.user.roleId` y
 * cachea por `caps:default:<roleId>`. Si un usuario de portal viviera en `req.user`, cualquier
 * ruta interna que quedara mal montada le aplicaría las capabilities del rol interno que
 * tuviera ese mismo número. Con el principal en otra propiedad, `requireCapability` responde
 * «No autenticado» y no hay forma de que confunda los dos mundos.
 *
 * Igual que el interno, **relee la base en cada request**: el `clienteUsuario` y su `Cliente`
 * tienen que estar activos y no eliminados. Una baja impacta de inmediato, no cuando expire
 * el token.
 */

import { getModels } from '../../database.js';
import { responseManager } from '../../kernel/index.js';
import { verificarTokenPortal, TIPO_ACCESS } from './portalToken.service.js';

/**
 * Resuelve los modelos del request (igual que el middleware interno).
 * @param {import('express').Request} req - Request.
 * @returns {object} Modelos.
 */
const resolverModels = (req) => {
    if (!req.models) req.models = getModels();
    return req.models;
};

/**
 * Exige un access token válido del portal.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @param {import('express').NextFunction} next - Siguiente middleware.
 * @returns {Promise<void>}
 */
export const verifyPortalToken = async (req, res, next) => {
    const token = req.headers['x-access-token'];
    if (!token) return responseManager(401, 'No se proporcionó token', req, res, false);

    const { ok, sub, expirado } = verificarTokenPortal(token, TIPO_ACCESS);
    if (!ok) {
        return expirado
            ? responseManager(401, 'Tu sesión expiró', req, res, false, { errorCode: 'TOKEN_EXPIRED' })
            : responseManager(401, 'Token inválido', req, res, false);
    }

    const { ClienteUsuario, Cliente } = resolverModels(req);
    const usuario = await ClienteUsuario.findOne({
        where: { id: sub },
        attributes: { exclude: ['password'] },
        // El Cliente es paranoid: sin el include, un cliente eliminado seguiría dejando
        // entrar a sus usuarios.
        include: [{ model: Cliente, required: true, attributes: ['id', 'nombre', 'activo'] }]
    });

    if (!usuario || !usuario.activo) return responseManager(403, 'Acceso no habilitado', req, res, false);
    if (!usuario.cliente?.activo) return responseManager(403, 'Acceso no habilitado', req, res, false);

    // El alcance sale de la FILA, no del token: mover o dar de baja a un usuario impacta ya.
    req.clienteUsuario = usuario;
    req.clienteId = usuario.clienteId;
    return next();
};
