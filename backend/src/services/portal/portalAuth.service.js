/**
 * Login del portal de clientes.
 *
 * Copia deliberadamente el guion de `kernel/users/controllers/auth.controller.js`: lockout
 * ANTES de tocar la tabla, mensaje único para «no existe / está inactivo / la clave está mal»
 * y registro del intento incluso para usuarios inexistentes. Esta superficie mira a internet
 * abierto, así que además verifica contra un hash señuelo cuando el usuario no existe: sin
 * eso, el tiempo de respuesta delata qué direcciones están dadas de alta.
 */

import { hashPassword, verifyPassword, rehashIfNeeded } from '../../kernel/auth/password.js';
import { lockoutSecondsRemaining, registerLoginAttempt } from '../../kernel/auth/lockout.service.js';
import { emitirSesionPortal, verificarTokenPortal, TIPO_REFRESH } from './portalToken.service.js';

/**
 * Hash señuelo contra el que verificar cuando el usuario no existe, para que el login tarde lo
 * mismo exista o no. Se calcula una vez, en el primer uso.
 */
let hashSenuelo = null;
const obtenerSenuelo = async () => {
    if (!hashSenuelo) hashSenuelo = await hashPassword(`senuelo-${Math.random()}`);
    return hashSenuelo;
};

/**
 * Los modelos de lockout del PORTAL. `lockout.service.js` hace `const { LoginAttempt } = models`,
 * así que mapeando el nombre se reusa el kernel sin tocarlo y sin compartir la tabla con el
 * login interno (ver el modelo `PortalLoginAttempt` para el porqué).
 * @param {object} models - Modelos de la app.
 * @returns {object} Modelos con el LoginAttempt del portal.
 */
const modelosLockout = (models) => ({ ...models, LoginAttempt: models.PortalLoginAttempt });

/**
 * Autentica a un usuario de portal.
 * @param {object} models - Modelos de la app.
 * @param {string} email - Email de login.
 * @param {string} password - Contraseña.
 * @param {string} ip - IP del request.
 * @returns {Promise<{ok: true, sesion: object}|{ok: false, status: number, message: string, errorCode?: string}>} Resultado.
 */
export const loginPortal = async (models, email, password, ip) => {
    const { ClienteUsuario, Cliente } = models;
    const lock = modelosLockout(models);

    const bloqueado = await lockoutSecondsRemaining(lock, email, ip);
    if (bloqueado > 0) {
        return {
            ok: false, status: 429, errorCode: 'LOGIN_LOCKED',
            message: `Demasiados intentos. Probá de nuevo en ${Math.ceil(bloqueado / 60)} minuto(s).`
        };
    }

    const usuario = await ClienteUsuario.findOne({
        where: { email: String(email).trim().toLowerCase() },
        include: [{ model: Cliente, required: false, attributes: ['id', 'nombre', 'activo'] }]
    });

    // Verificar SIEMPRE, exista o no: si no, el tiempo de respuesta delata qué mails existen.
    const hash = usuario ? usuario.password : await obtenerSenuelo();
    const passwordOk = await verifyPassword(hash, password);

    const habilitado = !!usuario && usuario.activo && !!usuario.cliente?.activo;
    if (!usuario || !passwordOk || !habilitado) {
        await registerLoginAttempt(lock, email, ip, false);
        // Mensaje único: no se le confirma a nadie si el mail existe, si está desactivado o si
        // el cliente está dado de baja.
        return { ok: false, status: 401, message: 'Credenciales inválidas' };
    }

    await registerLoginAttempt(lock, email, ip, true);
    await rehashIfNeeded(usuario, password);
    await usuario.update({ ultimoAccesoAt: new Date(), ultimoAccesoIp: ip });

    return { ok: true, sesion: emitirSesionPortal(usuario, usuario.cliente) };
};

/**
 * Renueva la sesión a partir de un refresh token del portal.
 * @param {object} models - Modelos de la app.
 * @param {string} refreshToken - El refresh token.
 * @returns {Promise<{ok: true, sesion: object}|{ok: false, status: number, message: string}>} Resultado.
 */
export const refrescarPortal = async (models, refreshToken) => {
    const { ClienteUsuario, Cliente } = models;
    if (!refreshToken) return { ok: false, status: 401, message: 'No se proporcionó token' };

    const { ok, sub } = verificarTokenPortal(refreshToken, TIPO_REFRESH);
    if (!ok) return { ok: false, status: 401, message: 'Token inválido' };

    const usuario = await ClienteUsuario.findOne({
        where: { id: sub },
        include: [{ model: Cliente, required: true, attributes: ['id', 'nombre', 'activo'] }]
    });
    // Mismo criterio que el middleware: el estado se relee, no se hereda del token.
    if (!usuario || !usuario.activo || !usuario.cliente?.activo) {
        return { ok: false, status: 403, message: 'Acceso no habilitado' };
    }
    return { ok: true, sesion: emitirSesionPortal(usuario, usuario.cliente) };
};
