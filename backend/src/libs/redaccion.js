/**
 * Redacción de datos sensibles antes de PERSISTIRLOS en las tablas de auditoría
 * (`action_trackings`, `errorLogs`).
 *
 * Existe porque la redacción estaba escrita en un solo lado: `responseManager` tachaba los
 * headers antes de guardar un error, pero `actionTracking` guardaba `JSON.stringify(req.headers)`
 * crudo en CADA request. Resultado: 38.553 filas con el `x-access-token` del usuario en texto
 * plano, legibles por cualquiera con acceso a la base o a un backup.
 *
 * La regla es por PATRÓN y no por lista cerrada: una lista exacta envejece mal (el día que
 * alguien agrega `x-portal-access-token` o un campo `nuevaPassword`, vuelve la fuga). Preferimos
 * tachar de más antes que dejar pasar un secreto.
 */

/** Claves cuyo VALOR nunca se persiste (se compara contra la clave en minúsculas). */
const PATRON_SENSIBLE = /(token|authorization|cookie|password|secret|api[-_]?key|contrasen|clave)/i;

/**
 * Copia de los headers con los valores sensibles tachados.
 * @param {object} [headers] - Headers del request.
 * @returns {object} Copia segura de persistir.
 */
export const redactarHeaders = (headers = {}) => {
    const copia = {};
    for (const [clave, valor] of Object.entries(headers)) {
        copia[clave] = PATRON_SENSIBLE.test(clave) ? '[REDACTED]' : valor;
    }
    return copia;
};

/**
 * Copia del body con los valores sensibles tachados.
 *
 * Tacha en vez de omitir: saber que el request TRAÍA una contraseña es información de
 * auditoría; el valor no. Solo mira el primer nivel, que es donde viven estos campos en la
 * app (y recorrer en profundidad un body arbitrario invita a un ciclo infinito).
 * @param {object} [body] - Body del request.
 * @returns {object} Copia segura de persistir.
 */
export const redactarBody = (body = {}) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body ?? {};
    const copia = {};
    for (const [clave, valor] of Object.entries(body)) {
        copia[clave] = PATRON_SENSIBLE.test(clave) ? '[REDACTED]' : valor;
    }
    return copia;
};
