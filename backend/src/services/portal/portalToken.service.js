/**
 * Tokens del portal de clientes.
 *
 * ⚠️ Esta es la pieza de seguridad más delicada de la feature. El sistema interno firma
 * `{ id, username, type: 'access' }` con `JWT_SECRET`, y `verifyAccessToken` hace
 * literalmente `jwt.verify(token, JWT_SECRET)` → `User.findOne({ where: { id: decoded.id } })`.
 * Un token de cliente con `id: 1` resolvería al usuario interno 1, que en este sistema es el
 * administrador del seed.
 *
 * Por eso hay TRES cerrojos independientes, y cada uno alcanza por sí solo:
 *  1. **Secreto propio** (`JWT_PORTAL_SECRET`), sin fallback a `JWT_SECRET` y con fail-fast al
 *     boot si falta o si es igual al interno.
 *  2. **`type` propio** (`portal_access` / `portal_refresh`): aunque los secretos colisionaran,
 *     `verifyAccessToken` corta en su chequeo de `type !== 'access'`.
 *  3. **El id va en `sub`, no en `id`**: si aun así llegara al `findOne`, buscaría
 *     `{ id: undefined }` y no matchearía a nadie.
 *
 * El `clienteId` NO viaja en el token: se deriva de la fila en cada request. Si mañana se da
 * de baja a un usuario de portal, o se lo mueve de cliente, un token viejo no puede seguir
 * leyendo lo de antes hasta que expire.
 */

import jwt from 'jsonwebtoken';

/** TTLs propios: los del sistema interno son configurables y subirlos ensancharía esta ventana. */
const ACCESS_TTL = process.env.PORTAL_ACCESS_TOKEN_EXPIRY || '30m';
const REFRESH_TTL = process.env.PORTAL_REFRESH_TOKEN_EXPIRY || '7d';

export const TIPO_ACCESS = 'portal_access';
export const TIPO_REFRESH = 'portal_refresh';

/**
 * El secreto del portal. Nunca cae a `JWT_SECRET`: un fallback silencioso convertiría los tres
 * cerrojos en uno solo el día que alguien olvide la variable.
 * @returns {string} El secreto.
 * @throws {Error} Si no está configurado (no debería pasar: el boot ya falla).
 */
const secreto = () => {
    const s = process.env.JWT_PORTAL_SECRET;
    if (!s || !s.trim()) throw new Error('JWT_PORTAL_SECRET no está configurado');
    return s;
};

/**
 * Valida la configuración de secretos del portal. La llama el boot para fallar temprano.
 * @returns {{ok: boolean, error?: string, warn?: string}} Resultado de la validación.
 */
export const validarConfigPortal = () => {
    const s = process.env.JWT_PORTAL_SECRET;
    if (!s || !s.trim()) {
        return { ok: false, error: 'JWT_PORTAL_SECRET no está configurado (lo necesita el portal de clientes).' };
    }
    if (s === process.env.JWT_SECRET) {
        return {
            ok: false,
            error: 'JWT_PORTAL_SECRET no puede ser igual a JWT_SECRET: con el mismo secreto, un token de cliente podría valer como sesión interna.'
        };
    }
    if (s.length < 32) return { ok: true, warn: 'JWT_PORTAL_SECRET es corto (<32 chars). Usá uno largo y aleatorio.' };
    return { ok: true };
};

/**
 * Emite la sesión de un usuario de portal.
 * @param {object} clienteUsuario - Fila de `ClienteUsuario`.
 * @param {object} cliente - Su cliente (para devolver el nombre a la UI).
 * @returns {object} `{ accessToken, refreshToken, expiresIn, usuario }`.
 */
export const emitirSesionPortal = (clienteUsuario, cliente) => {
    // `sub` y no `id`, a propósito (ver el encabezado del archivo).
    const base = { sub: clienteUsuario.id, email: clienteUsuario.email };
    return {
        accessToken: jwt.sign({ ...base, type: TIPO_ACCESS }, secreto(), { expiresIn: ACCESS_TTL }),
        refreshToken: jwt.sign({ ...base, type: TIPO_REFRESH }, secreto(), { expiresIn: REFRESH_TTL }),
        expiresIn: ACCESS_TTL,
        usuario: {
            id: clienteUsuario.id,
            nombre: clienteUsuario.nombre,
            email: clienteUsuario.email,
            cliente: cliente ? { id: cliente.id, nombre: cliente.nombre } : null
        }
    };
};

/**
 * Verifica un token del portal.
 * @param {string} token - El token.
 * @param {string} tipoEsperado - `TIPO_ACCESS` o `TIPO_REFRESH`.
 * @returns {{ok: boolean, sub?: number, expirado?: boolean}} El resultado.
 */
export const verificarTokenPortal = (token, tipoEsperado) => {
    try {
        const decoded = jwt.verify(token, secreto());
        if (decoded.type !== tipoEsperado) return { ok: false };
        return { ok: true, sub: Number(decoded.sub) };
    } catch (e) {
        return { ok: false, expirado: e?.name === 'TokenExpiredError' };
    }
};
