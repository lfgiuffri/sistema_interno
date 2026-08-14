/**
 * Service del módulo `mantenimiento` — sección Sitios web.
 *
 * Estado del dominio (ok / por vencer / vencido) NO se guarda: se deriva de la fecha de
 * vencimiento contra la ventana configurada. Guardar un estado calculado obliga a recalcularlo
 * en cada consulta o a vivir con datos viejos; derivarlo siempre da la respuesta correcta.
 */

import { Op } from 'sequelize';
import { getAppConfigNumber } from '../../../kernel/index.js';
import { dominioDe } from './rdap.service.js';

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
 * Estado del dominio (o del certificado) según su fecha de vencimiento.
 * @param {string|null} venceAt - Fecha de vencimiento (YYYY-MM-DD).
 * @param {number} diasAviso - Días de anticipación para "próximo a vencer".
 * @returns {{estado: 'ok'|'por_vencer'|'vencido'|'sin_dato', dias: number|null}} Estado y días restantes.
 */
export const estadoVencimiento = (venceAt, diasAviso) => {
    if (!venceAt) return { estado: 'sin_dato', dias: null };
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((new Date(`${venceAt}T00:00:00`) - hoy) / 86400000);
    if (dias < 0) return { estado: 'vencido', dias };
    if (dias <= diasAviso) return { estado: 'por_vencer', dias };
    return { estado: 'ok', dias };
};

/**
 * Listado de sitios con su servicio, su servidor y los estados derivados.
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object[]>} Sitios listos para la tabla.
 */
export const listSitios = async (models) => {
    const { SitioWeb, Servicio, Servidor, SitioIncidente } = models;

    const [sitios, diasDominio, diasTls] = await Promise.all([
        SitioWeb.findAll({
            include: [
                { model: Servicio, as: 'servicio', attributes: ['id', 'nombre'], required: false, paranoid: false },
                { model: Servidor, as: 'servidor', attributes: ['id', 'nombre'], required: false, paranoid: false },
            ],
            order: [['nombre', 'ASC']],
        }),
        getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_DOMINIO'),
        getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_TLS'),
    ]);
    if (!sitios.length) return [];

    const abiertos = await SitioIncidente.findAll({
        where: { sitioId: { [Op.in]: sitios.map(s => s.id) }, resueltoAt: null },
        raw: true,
    });
    const porSitio = {};
    for (const i of abiertos) (porSitio[i.sitioId] ??= []).push(i.tipo);

    return sitios.map(s => {
        const json = s.toJSON();
        return {
            ...json,
            dominioEstado: estadoVencimiento(json.dominioVenceAt, diasDominio),
            tlsEstado: estadoVencimiento(json.tlsVenceAt, diasTls),
            incidentes: porSitio[s.id] ?? [],
        };
    });
};

/**
 * Un sitio con su historial de chequeos y sus incidentes.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Sitio.
 * @returns {Promise<object|null>} Ficha del sitio o null.
 */
export const getSitio = async (models, id) => {
    const { SitioWeb, SitioChequeo, SitioIncidente, Servicio, Servidor } = models;
    const sitio = await SitioWeb.findByPk(id, {
        include: [
            { model: Servicio, as: 'servicio', attributes: ['id', 'nombre'], required: false, paranoid: false },
            { model: Servidor, as: 'servidor', attributes: ['id', 'nombre'], required: false, paranoid: false },
        ],
    });
    if (!sitio) return null;

    const [chequeos, incidentes, diasDominio, diasTls] = await Promise.all([
        SitioChequeo.findAll({ where: { sitioId: id }, order: [['createdAt', 'DESC']], limit: 200, raw: true }),
        SitioIncidente.findAll({ where: { sitioId: id }, order: [['createdAt', 'DESC']], limit: 30, raw: true }),
        getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_DOMINIO'),
        getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_TLS'),
    ]);

    // Disponibilidad de la ventana guardada: cuántos chequeos dieron online.
    const online = chequeos.filter(c => c.estado === 'online').length;
    const json = sitio.toJSON();

    return {
        ...json,
        dominioEstado: estadoVencimiento(json.dominioVenceAt, diasDominio),
        tlsEstado: estadoVencimiento(json.tlsVenceAt, diasTls),
        disponibilidad: chequeos.length ? Math.round((online / chequeos.length) * 1000) / 10 : null,
        chequeos: chequeos.slice(0, 60),
        incidentes,
    };
};

/**
 * Valida que la URL sea http(s) y devuelve su dominio.
 * @param {string} url - URL cargada.
 * @returns {string} Dominio normalizado.
 * @throws {Error} 400 si la URL no sirve para monitorear.
 */
const validarUrl = (url) => {
    let parsed;
    try { parsed = new URL(url); } catch { throw bizError(400, 'La URL no es válida (tiene que incluir http:// o https://)'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw bizError(400, 'La URL tiene que empezar con http:// o https://');
    return dominioDe(url);
};

/**
 * Crea un sitio.
 * @param {object} models - Modelos de la app.
 * @param {object} data - Campos del sitio.
 * @returns {Promise<object>} El sitio creado.
 */
export const createSitio = async (models, data) => {
    const { SitioWeb } = models;
    const dominio = validarUrl(data.url);

    const existe = await SitioWeb.findOne({ where: { url: data.url } });
    if (existe) throw bizError(400, 'Ya hay un sitio cargado con esa URL');

    // `dominioAuto` arranca en false: lo pone en true el refresco de RDAP si logra la fecha.
    return SitioWeb.create({ ...data, dominio });
};

/**
 * Actualiza un sitio. Si cambia la URL se recalcula el dominio y se limpia el estado.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Sitio.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} El sitio actualizado o null si no existe.
 */
export const updateSitio = async (models, id, data) => {
    const { SitioWeb } = models;
    const sitio = await SitioWeb.findByPk(id);
    if (!sitio) return null;

    const cambios = { ...data };
    // El formulario manda cadena vacía para "sin fecha" (ver el validator).
    if (cambios.dominioVenceAt === '') cambios.dominioVenceAt = null;

    if (data.url && data.url !== sitio.url) {
        cambios.dominio = validarUrl(data.url);
        const existe = await SitioWeb.findOne({ where: { url: data.url, id: { [Op.ne]: id } } });
        if (existe) throw bizError(400, 'Ya hay un sitio cargado con esa URL');
        // Dominio distinto: la fecha que había ya no aplica y se vuelve a lo automático.
        if (cambios.dominio !== sitio.dominio) {
            cambios.dominioVenceAt = null;
            cambios.dominioAuto = true;
            cambios.dominioConsultadoAt = null;
        }
    }
    // Fecha cargada a mano → deja de ser automática (no la pisa el refresco de RDAP).
    // Borrarla es la operación inversa: se vuelve al refresco automático. Va DESPUÉS del
    // bloque de la URL para que un PUT que cambia la URL y carga una fecha a la vez termine
    // en manual, no en automático.
    if (cambios.dominioVenceAt !== undefined && cambios.dominioVenceAt !== sitio.dominioVenceAt) {
        cambios.dominioAuto = cambios.dominioVenceAt === null;
        // Dominio recalculado de la URL: si venía de una consulta previa, ya no vale.
        if (cambios.dominioVenceAt === null) cambios.dominio = dominioDe(cambios.url ?? sitio.url);
    }

    await sitio.update(cambios);
    return sitio;
};

/**
 * Alterna el estado activo (un sitio inactivo no se chequea ni alerta).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Sitio.
 * @returns {Promise<object|null>} El sitio o null.
 */
export const toggleSitio = async (models, id) => {
    const sitio = await models.SitioWeb.findByPk(id);
    if (!sitio) return null;
    await sitio.update({ activo: !sitio.activo });
    return sitio;
};

/**
 * Elimina (soft) un sitio y cierra sus incidentes abiertos.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Sitio.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 */
export const deleteSitio = async (models, id) => {
    const { SitioWeb, SitioIncidente } = models;
    const sitio = await SitioWeb.findByPk(id);
    if (!sitio) return false;
    await SitioIncidente.update({ resueltoAt: new Date() }, { where: { sitioId: id, resueltoAt: null } });
    await sitio.destroy();
    return true;
};
