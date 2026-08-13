/**
 * Saneado de HTML de descripciones de tareas — SEGURIDAD CRÍTICA.
 *
 * Réplica de la lista blanca del legado (../analisis_app_php/03 §2.11) sobre sanitize-html:
 *  - script/style/iframe/object/embed/svg se eliminan CON contenido; el resto de las
 *    etiquetas desconocidas se "desenvuelven" (queda el contenido).
 *  - Atributos fuera de lista blanca se quitan (adiós on*, style).
 *  - href solo http/https/mailto; src de <img> SOLO nuestro endpoint de archivos
 *    (`/api/tareas/archivos/<nombre>` — la regex del legado se adaptó al nuevo esquema, §5.28).
 *  - class solo checklist/checklist-item/hecho; una clase ajena invalida el atributo.
 *  - Todo <a> queda con target="_blank" + rel="noopener noreferrer" FORZADOS.
 *  - Resultado sin texto ni imágenes → ''.
 * Se aplica al GUARDAR y al SERVIR (por si el contenido es anterior a un cambio de lista blanca).
 */

import sanitizeHtml from 'sanitize-html';

/** Regex del src permitido para imágenes embebidas (nuestro endpoint autenticado). */
const IMG_SRC_RE = /(^|\/)(api\/)?tareas\/archivos\/[0-9]{6}_[0-9a-f]{20}\.(png|jpg|jpeg|gif|webp)$/i;

/** Clases permitidas (solo las del checklist del editor). */
const CLASES_PERMITIDAS = new Set(['checklist', 'checklist-item', 'hecho']);

/**
 * Filtra un atributo class: si alguna clase no está en la lista blanca, se invalida entero.
 * @param {string} value - Valor del atributo class.
 * @returns {string|null} El class saneado o null para quitarlo.
 */
const filtrarClass = (value) => {
    const clases = String(value || '').split(/\s+/).filter(Boolean);
    if (!clases.length || clases.some(c => !CLASES_PERMITIDAS.has(c))) return null;
    return clases.join(' ');
};

const OPCIONES = {
    allowedTags: [
        'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup',
        'h1', 'h2', 'h3', 'h4', 'ol', 'ul', 'li', 'blockquote', 'pre', 'code', 'hr',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img'
    ],
    allowedAttributes: {
        // data-type: lo usa el editor (TipTap) para reconocer el checklist al re-editar.
        ul: ['class', 'data-type'],
        li: ['class', 'data-checked', 'data-type'],
        a: ['href', 'title', 'target', 'rel'],
        img: ['src', 'alt', 'title'],
        th: ['colspan', 'rowspan'],
        td: ['colspan', 'rowspan']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    // Etiquetas desconocidas: se desenvuelven (discard sin nonTextTags conserva el contenido).
    disallowedTagsMode: 'discard',
    // Estas se eliminan CON contenido (mismo set que el legado + los defaults de la lib).
    nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'textarea', 'option', 'noscript'],
    transformTags: {
        // Enlaces: target y rel forzados SIEMPRE (anti tab-nabbing).
        a: (tagName, attribs) => ({
            tagName: 'a',
            attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
        })
    },
    exclusiveFilter: (frame) => {
        // Imágenes: el src debe apuntar a nuestro endpoint (nombre aleatorio validado).
        if (frame.tag === 'img') {
            const src = frame.attribs?.src || '';
            if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return true; // src con esquema absoluto: afuera
            return !IMG_SRC_RE.test(src);
        }
        return false;
    }
};

/**
 * Sanea el HTML de una descripción de tarea con la lista blanca del legado.
 * @param {string|null|undefined} html - HTML crudo (del editor o de la base).
 * @returns {string} HTML seguro; '' si no queda texto ni imágenes.
 */
export const sanearHtml = (html) => {
    if (!html) return '';
    let limpio = sanitizeHtml(String(html), OPCIONES);

    // Post-proceso del class (sanitize-html no filtra valores): inválido → se quita.
    limpio = limpio.replace(/\sclass="([^"]*)"/gi, (_m, v) => {
        const ok = filtrarClass(v);
        return ok === null ? '' : ` class="${ok}"`;
    });

    // Sin texto ni imágenes → vacío (regla del legado).
    const soloTexto = limpio.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
    if (!soloTexto && !/<img\s/i.test(limpio)) return '';
    return limpio;
};
