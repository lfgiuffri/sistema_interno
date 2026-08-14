/**
 * Consulta de vencimiento de dominios por RDAP (el reemplazo moderno de WHOIS: JSON, sin
 * scrapear texto).
 *
 * Se resuelve el servidor autoritativo con el bootstrap oficial de IANA en vez de usar el
 * redirector público rdap.org: así no dependemos de un tercero. NIC Argentina publica RDAP,
 * así que los `.com.ar` devuelven fecha; los TLD que NO tienen RDAP (.io, .uy, .cl…) se
 * informan como tal para que la fecha se cargue a mano.
 */

/** Bootstrap de IANA: qué servidor RDAP atiende cada TLD. */
const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
/** El bootstrap cambia muy de vez en cuando: se cachea en memoria por un día. */
const CACHE_MS = 24 * 3600 * 1000;
const TIMEOUT_MS = 12000;

let cache = { at: 0, porTld: null };

/**
 * Sufijos públicos de dos etiquetas: son registros, no dominios registrables.
 *
 * Sin esto, al ir sacando etiquetas de `no-existe.com.ar` se llega a `com.ar`, que en RDAP
 * de NIC.ar EXISTE y contesta con su propia fecha (año 2100): un dominio inexistente
 * terminaba mostrando un vencimiento inventado. Lista corta a propósito — cubre los sufijos
 * que usamos; para cualquier otro TLD el algoritmo de siempre alcanza.
 */
const SUFIJOS_PUBLICOS = new Set([
    'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'int.ar', 'mil.ar', 'tur.ar', 'edu.ar',
    'com.br', 'com.mx', 'com.uy', 'com.py', 'com.bo', 'com.pe', 'com.co', 'com.ve',
    'co.uk', 'org.uk', 'com.es', 'com.au', 'co.nz',
]);

/**
 * Descarga (y cachea) el mapa TLD → servidor RDAP.
 * @returns {Promise<Record<string, string>|null>} Mapa o null si no se pudo bajar.
 */
const mapaTld = async () => {
    if (cache.porTld && Date.now() - cache.at < CACHE_MS) return cache.porTld;
    try {
        const res = await fetch(BOOTSTRAP_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return cache.porTld;
        const data = await res.json();
        const porTld = {};
        for (const [tlds, urls] of data.services) {
            for (const t of tlds) porTld[t.toLowerCase()] = urls[0].replace(/\/$/, '');
        }
        cache = { at: Date.now(), porTld };
        return porTld;
    } catch {
        return cache.porTld; // si falla, se sigue usando lo último que se pudo bajar
    }
};

/**
 * Dominio registrable de una URL, sin `www.`.
 * @param {string} url - URL del sitio.
 * @returns {string|null} Hostname normalizado o null si la URL es inválida.
 */
export const dominioDe = (url) => {
    try {
        return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return null;
    }
};

/**
 * Consulta el vencimiento de un dominio.
 *
 * Si el host tiene subdominios (`app.cliente.com.ar`), va sacando etiquetas de a una hasta
 * dar con el dominio registrado: es la forma simple de resolver que en `.com.ar` el registro
 * son TRES etiquetas y en `.com` dos, sin arrastrar la Public Suffix List entera.
 * @param {string} host - Dominio a consultar.
 * @returns {Promise<{ok: boolean, dominio?: string, venceAt?: string|null, motivo?: string}>}
 */
export const vencimientoDominio = async (host) => {
    if (!host) return { ok: false, motivo: 'URL inválida' };

    const porTld = await mapaTld();
    if (!porTld) return { ok: false, motivo: 'No se pudo consultar el directorio de RDAP' };

    const tld = host.split('.').pop();
    const base = porTld[tld];
    if (!base) return { ok: false, motivo: `El registro de .${tld} no publica RDAP: cargá la fecha a mano` };

    // De más específico a más general: app.cliente.com.ar → cliente.com.ar → com.ar
    const partes = host.split('.');
    for (let i = 0; i < partes.length - 1; i++) {
        const candidato = partes.slice(i).join('.');
        // `com.ar` y compañía son el registro, no un dominio de alguien: no se consultan.
        if (SUFIJOS_PUBLICOS.has(candidato)) break;
        try {
            const res = await fetch(`${base}/domain/${candidato}`, {
                headers: { Accept: 'application/rdap+json' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (res.status === 404) continue;         // todavía no es el dominio registrado
            if (!res.ok) return { ok: false, motivo: `RDAP respondió ${res.status}` };

            const data = await res.json();
            const evento = (data.events || []).find(e => e.eventAction === 'expiration');
            if (!evento?.eventDate) return { ok: false, dominio: candidato, motivo: 'RDAP no informa la fecha de vencimiento' };

            return { ok: true, dominio: candidato, venceAt: String(evento.eventDate).slice(0, 10) };
        } catch (e) {
            return { ok: false, motivo: `No se pudo consultar RDAP: ${String(e.message).slice(0, 80)}` };
        }
    }
    return { ok: false, motivo: 'RDAP no encontró el dominio' };
};
