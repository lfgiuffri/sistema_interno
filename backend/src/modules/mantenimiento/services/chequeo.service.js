/**
 * Chequeo de disponibilidad de un sitio web + vencimiento de su certificado TLS.
 *
 * TRES estados, no dos:
 *  - `online`: responde 2xx **y** trae el marcador `<div id="app-conn-id">` del footer.
 *  - `sin_marcador`: responde 2xx pero sin el marcador. Suele ser un deploy roto o la página
 *    del hosting: el servidor contesta, pero lo que sirve no es nuestro sitio.
 *  - `offline`: timeout, error de conexión, TLS inválido o status distinto de 2xx.
 */

import tls from 'tls';

/**
 * Marcador que todos nuestros sitios llevan en el footer, cuando nadie configuró otro.
 *
 * Es solo el default: el id real sale de la config `MANTENIMIENTO_MARCADOR_ID` y una vista
 * puede pisarlo con el suyo (`SitioVista.marcadorId`). Se mantiene acá para que el chequeo
 * siga funcionando aunque la config no exista todavía.
 */
export const MARCADOR_ID_DEFAULT = 'app-conn-id';
/** Timeout del pedido HTTP: más de esto es una caída a los efectos prácticos. */
const TIMEOUT_MS = 12000;

/**
 * ¿El HTML trae el marcador? Tolerante a comillas simples/dobles, mayúsculas y a que el
 * atributo `id` no sea el primero del tag.
 * @param {string} html - Cuerpo de la respuesta.
 * @returns {boolean} true si aparece el marcador.
 */
export const tieneMarcador = (html, marcadorId = MARCADOR_ID_DEFAULT) => {
    // El id se escapa: viene de la configuración y podría traer un `.` o un `-` que en una
    // expresión regular significan otra cosa.
    const id = String(marcadorId || MARCADOR_ID_DEFAULT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`id\\s*=\\s*['"]${id}['"]`, 'i').test(String(html || ''));
};

/**
 * Lee el vencimiento del certificado TLS abriendo un handshake (no descarga la página).
 * @param {string} host - Hostname.
 * @param {number} [puerto] - Puerto TLS.
 * @returns {Promise<string|null>} Fecha de vencimiento (YYYY-MM-DD) o null si no se pudo leer.
 */
export const vencimientoTls = (host, puerto = 443) => new Promise((resolve) => {
    let listo = false;
    /**
     * Resuelve una sola vez y cierra el socket.
     * @param {string|null} valor - Fecha o null.
     * @param {object} [socket] - Socket a cerrar.
     * @returns {void}
     */
    const terminar = (valor, socket) => {
        if (listo) return;
        listo = true;
        socket?.destroy();
        resolve(valor);
    };

    try {
        // rejectUnauthorized false a propósito: queremos LEER la fecha aunque el certificado
        // esté vencido o no valide — justamente ese es el caso que hay que avisar.
        const socket = tls.connect({ host, port: puerto, servername: host, rejectUnauthorized: false, timeout: TIMEOUT_MS }, () => {
            const cert = socket.getPeerCertificate();
            const hasta = cert?.valid_to ? new Date(cert.valid_to) : null;
            terminar(hasta && !Number.isNaN(hasta.getTime()) ? hasta.toISOString().slice(0, 10) : null, socket);
        });
        socket.once('error', () => terminar(null, socket));
        socket.once('timeout', () => terminar(null, socket));
    } catch {
        terminar(null);
    }
});

/**
 * Chequea un sitio: descarga la URL, busca el marcador y (si es https) lee el vencimiento
 * del certificado.
 * @param {string} url - URL del sitio.
 * @param {boolean} [verificaMarcador] - Si false, alcanza con un 2xx (sitios de terceros).
 * @param {string} [marcadorId] - Id del marcador a buscar (config global u override de la vista).
 * @returns {Promise<{estado: string, httpStatus: number|null, tiempoMs: number, motivo: string|null, tlsVenceAt: string|null}>}
 */
export const chequearSitio = async (url, verificaMarcador = true, marcadorId = MARCADOR_ID_DEFAULT) => {
    const inicio = Date.now();
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), TIMEOUT_MS);

    let httpStatus = null;
    let estado = 'offline';
    let motivo = null;

    try {
        const res = await fetch(url, {
            redirect: 'follow',
            signal: control.signal,
            // Algunos WAF/hostings bloquean pedidos sin user-agent.
            headers: { 'User-Agent': 'SistemaInterno-Monitor/1.0 (+monitoreo interno)' },
        });
        httpStatus = res.status;

        if (!res.ok) {
            motivo = `El servidor respondió ${res.status}`;
        } else if (!verificaMarcador) {
            estado = 'online'; // alcanza con que responda: no es un sitio nuestro
        } else {
            const html = await res.text();
            estado = tieneMarcador(html, marcadorId) ? 'online' : 'sin_marcador';
            if (estado === 'sin_marcador') motivo = `Responde ${res.status} pero falta el marcador #${marcadorId}`;
        }
    } catch (e) {
        motivo = e.name === 'AbortError'
            ? `Sin respuesta en ${TIMEOUT_MS / 1000} segundos`
            : `No se pudo conectar: ${String(e.cause?.code || e.message).slice(0, 120)}`;
    } finally {
        clearTimeout(corte);
    }

    // El tiempo se congela ACÁ, antes del handshake TLS: ese es otro socket y sumarlo
    // inflaría la medición de velocidad con algo que el visitante no espera.
    const tiempoMs = Date.now() - inicio;

    let tlsVenceAt = null;
    try {
        const { protocol, hostname } = new URL(url);
        if (protocol === 'https:') tlsVenceAt = await vencimientoTls(hostname);
    } catch { /* URL inválida: ya quedó reflejado en el estado */ }

    return { estado, httpStatus, tiempoMs, motivo, tlsVenceAt };
};
