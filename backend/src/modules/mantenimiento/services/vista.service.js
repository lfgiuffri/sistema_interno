/**
 * Service de las **vistas** de un sitio: las URLs concretas que se chequean.
 *
 * Un sitio puede tener la home hecha por nosotros y un `/ecommerce` de un tercero. Chequear
 * solo la raíz diría «está en línea» mientras la tienda devuelve 500 desde ayer. Cada vista
 * se chequea aparte, con su propio «esto lo administramos nosotros» y su propio marcador.
 *
 * El sitio **resume** sus vistas (2 de 3 OK) y las **alertas son por vista**: hace falta saber
 * QUÉ dejó de funcionar, no solo que algo lo hizo.
 */

import { Op } from 'sequelize';
import { getAppConfig } from '../../../kernel/index.js';
import { MARCADOR_ID_DEFAULT } from './chequeo.service.js';

/**
 * Error de negocio con status (el controller lo mapea al envelope).
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje para el usuario.
 * @returns {Error} Error enriquecido.
 */
const bizError = (statusCode, message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

/**
 * Normaliza una ruta de vista: siempre arranca con `/`, sin barra final (salvo la home) y
 * sin dominio (si pegaron una URL completa, se le saca).
 * @param {string} raw - Ruta cargada.
 * @returns {string} Ruta normalizada.
 * @throws {Error} 400 si queda vacía o trae algo que no es una ruta.
 */
export const normalizarRuta = (raw) => {
    let r = String(raw ?? '').trim();
    if (!r) return '/';
    // Pegaron la URL completa: se conserva solo la ruta (+ query, que puede importar).
    if (/^https?:\/\//i.test(r)) {
        try {
            const u = new URL(r);
            r = `${u.pathname}${u.search}`;
        } catch { throw bizError(400, 'La ruta de la vista no es válida'); }
    }
    if (!r.startsWith('/')) r = `/${r}`;
    // Barra final: `/tienda/` y `/tienda` son la misma vista, y tenerlas separadas duplicaría
    // los chequeos y las alertas. La home es la excepción: su ruta ES `/`.
    if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
    if (r.includes(' ')) throw bizError(400, 'La ruta de la vista no puede tener espacios');
    if (r.length > 190) throw bizError(400, 'La ruta de la vista es demasiado larga');
    return r;
};

/**
 * URL absoluta que se chequea para una vista.
 *
 * Se arma con `new URL` y no concatenando: la URL del sitio puede venir con o sin barra final,
 * y `https://x.com` + `/tienda` a mano da `https://x.com/tienda` pero `https://x.com/` +
 * `/tienda` daría `https://x.com//tienda`.
 * @param {string} urlSitio - URL base del sitio.
 * @param {string} ruta - Ruta de la vista.
 * @returns {string} URL absoluta.
 */
export const urlDeVista = (urlSitio, ruta) => {
    try {
        return new URL(ruta || '/', urlSitio).toString();
    } catch {
        return urlSitio;
    }
};

/**
 * Id del marcador que le corresponde a una vista: el suyo si lo tiene, si no el global.
 * @param {object} models - Modelos de la app.
 * @param {{marcadorId?: string|null}} vista - Vista.
 * @returns {Promise<string>} Id del marcador.
 */
export const marcadorDeVista = async (models, vista) => {
    if (vista?.marcadorId) return vista.marcadorId;
    try {
        return await getAppConfig(models, 'MANTENIMIENTO_MARCADOR_ID');
    } catch {
        // La config todavía no existe (instalación nueva antes del primer boot completo):
        // el chequeo no debe caerse por eso.
        return MARCADOR_ID_DEFAULT;
    }
};

/**
 * Vistas de un sitio, ordenadas como se muestran.
 * @param {object} models - Modelos de la app.
 * @param {number} sitioId - Sitio.
 * @returns {Promise<object[]>} Vistas.
 */
export const listVistas = async (models, sitioId) => {
    // Sin `raw: true`: con raw los BOOLEAN vuelven como el 0/1 de MySQL, y el resto de la API
    // devuelve true/false. `toJSON()` cuesta nada acá (son unas pocas filas por sitio) y evita
    // que el frontend tenga que tratar dos formas del mismo dato.
    const vistas = await models.SitioVista.findAll({
        where: { sitioId },
        order: [['orden', 'ASC'], ['ruta', 'ASC']],
    });
    return vistas.map(v => v.toJSON());
};

/**
 * Crea una vista de un sitio.
 * @param {object} models - Modelos de la app.
 * @param {number} sitioId - Sitio.
 * @param {object} data - Campos de la vista.
 * @returns {Promise<object>} La vista creada.
 * @throws {Error} 404 si el sitio no existe; 409 si la ruta ya está (o estaba eliminada).
 */
export const createVista = async (models, sitioId, data) => {
    const { SitioWeb, SitioVista } = models;
    const sitio = await SitioWeb.findByPk(sitioId);
    if (!sitio) throw bizError(404, 'El sitio no existe');

    const ruta = normalizarRuta(data.ruta);

    // La eliminada se reactiva en vez de chocar: es el mismo patrón de los catálogos. Sin
    // esto, borrar `/tienda` y volver a crearla daría un 409 sin salida visible.
    const eliminada = await SitioVista.findOne({ where: { sitioId, ruta }, paranoid: false });
    if (eliminada && eliminada.deletedAt) {
        await eliminada.restore();
        // El estado viejo no vale: pasó tiempo y nadie la chequeó mientras estaba de baja.
        await eliminada.update({
            ...data, ruta, activo: true,
            estado: 'desconocido', ultimoChequeoAt: null, ultimoCodigo: null,
            tiempoMs: null, fallosSeguidos: 0,
        });
        return eliminada;
    }
    if (eliminada) throw bizError(409, `Este sitio ya tiene una vista para «${ruta}»`);

    // Al final de la lista: `orden` en múltiplos de 10 deja lugar para intercalar.
    const ultima = await SitioVista.max('orden', { where: { sitioId } });
    return SitioVista.create({ ...data, sitioId, ruta, orden: (Number(ultima) || 0) + 10 });
};

/**
 * Actualiza una vista.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Vista.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} La vista o null si no existe.
 * @throws {Error} 409 si la ruta nueva choca con otra vista del mismo sitio.
 */
export const updateVista = async (models, id, data) => {
    const { SitioVista } = models;
    const vista = await SitioVista.findByPk(id);
    if (!vista) return null;

    const cambios = { ...data };
    if (data.ruta !== undefined) {
        cambios.ruta = normalizarRuta(data.ruta);
        if (cambios.ruta !== vista.ruta) {
            const choca = await SitioVista.findOne({
                where: { sitioId: vista.sitioId, ruta: cambios.ruta, id: { [Op.ne]: id } },
            });
            if (choca) throw bizError(409, `Este sitio ya tiene una vista para «${cambios.ruta}»`);
            // Otra URL es otro chequeo: el estado anterior no dice nada de la ruta nueva.
            Object.assign(cambios, { estado: 'desconocido', ultimoChequeoAt: null, ultimoCodigo: null, tiempoMs: null, fallosSeguidos: 0 });
        }
    }
    // Cadena vacía = «usá el marcador global» (el formulario no manda null).
    if (cambios.marcadorId === '') cambios.marcadorId = null;

    await vista.update(cambios);
    return vista;
};

/**
 * Alterna el activo de una vista (una vista inactiva no se chequea ni alerta).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Vista.
 * @returns {Promise<object|null>} La vista o null.
 */
export const toggleVista = async (models, id) => {
    const vista = await models.SitioVista.findByPk(id);
    if (!vista) return null;
    await vista.update({ activo: !vista.activo });
    return vista;
};

/**
 * Elimina (soft) una vista y cierra sus incidentes abiertos.
 *
 * La ÚLTIMA vista de un sitio no se elimina: un sitio sin ninguna URL que chequear dejaría de
 * monitorearse en silencio, que es exactamente lo que este módulo tiene que evitar. Para dejar
 * de mirarlo está desactivar el sitio, que es explícito y reversible.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Vista.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si es la última vista del sitio.
 */
export const deleteVista = async (models, id) => {
    const { SitioVista, SitioIncidente } = models;
    const vista = await SitioVista.findByPk(id);
    if (!vista) return false;

    const cuantas = await SitioVista.count({ where: { sitioId: vista.sitioId } });
    if (cuantas <= 1) {
        throw bizError(409, 'Es la única vista del sitio. Si no querés monitorearlo, desactivá el sitio.');
    }

    await SitioIncidente.update({ resueltoAt: new Date() }, { where: { vistaId: id, resueltoAt: null } });
    await vista.destroy();
    return true;
};

/**
 * Reordena las vistas de un sitio según el array de ids recibido.
 * @param {object} models - Modelos de la app.
 * @param {number} sitioId - Sitio.
 * @param {number[]} ids - Ids en el orden deseado.
 * @returns {Promise<object[]>} Las vistas ya ordenadas.
 */
export const reordenarVistas = async (models, sitioId, ids) => {
    const { SitioVista } = models;
    // Solo se mueven las que son del sitio: un id de otro sitio en el body no debe poder
    // reordenar nada ajeno.
    const propias = await SitioVista.findAll({ where: { sitioId, id: { [Op.in]: ids } }, attributes: ['id'], raw: true });
    const validos = new Set(propias.map(v => v.id));
    let orden = 10;
    for (const id of ids) {
        if (!validos.has(id)) continue;
        await SitioVista.update({ orden }, { where: { id } });
        orden += 10;
    }
    return listVistas(models, sitioId);
};

/**
 * Resumen de las vistas de un lote de sitios, para la fila del listado.
 *
 * El estado del SITIO es el PEOR de sus vistas activas: si la tienda está caída, el sitio no
 * está «en línea» por más que la home responda. Las inactivas no cuentan (nadie las chequea).
 * @param {object} models - Modelos de la app.
 * @param {number[]} sitioIds - Sitios.
 * @returns {Promise<Record<number, {total: number, ok: number, estado: string, tiempoMs: number|null, vistas: object[]}>>}
 */
export const resumenVistasPorSitio = async (models, sitioIds) => {
    const { SitioVista } = models;
    if (!sitioIds.length) return {};

    // Igual que en `listVistas`: sin `raw` para que los booleanos sean booleanos.
    const filas = await SitioVista.findAll({
        where: { sitioId: { [Op.in]: sitioIds } },
        order: [['orden', 'ASC'], ['ruta', 'ASC']],
    });
    const vistas = filas.map(v => v.toJSON());

    // Orden de gravedad: se elige el estado más grave presente entre las activas.
    const GRAVEDAD = { offline: 3, sin_marcador: 2, desconocido: 1, online: 0 };
    const out = {};
    for (const v of vistas) {
        const r = (out[v.sitioId] ??= { total: 0, ok: 0, estado: 'desconocido', tiempoMs: null, vistas: [] });
        r.vistas.push(v);
        if (!v.activo) continue;
        r.total += 1;
        if (v.estado === 'online') r.ok += 1;
        if (GRAVEDAD[v.estado] > GRAVEDAD[r.estado] || r.total === 1) r.estado = v.estado;
        // El tiempo que se muestra en la fila es el PEOR de las vistas: es el que duele.
        if (v.tiempoMs != null && (r.tiempoMs == null || v.tiempoMs > r.tiempoMs)) r.tiempoMs = v.tiempoMs;
    }
    return out;
};
