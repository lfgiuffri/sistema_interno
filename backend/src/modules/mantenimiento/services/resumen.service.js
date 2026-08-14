/**
 * Resumen de mantenimiento para el PANEL.
 *
 * A diferencia de las pantallas del módulo, acá NO va el detalle de cada servidor ni de cada
 * sitio: el panel responde una sola pregunta —«¿está todo bien?»— y solo cuando la respuesta
 * es que no, dice cuántos y de qué tipo. Para el detalle está la pantalla del módulo.
 *
 * Se calcula con conteos agregados (una consulta por dimensión), no recorriendo entidades:
 * el panel lo abre todo el mundo todo el tiempo y tiene que ser barato.
 */

import { Op } from 'sequelize';
import { getAppConfigNumber } from '../../../kernel/index.js';
import { estadoVencimiento } from './sitio.service.js';

/**
 * Resumen de los servidores: cuántos hay en cada estado y cuál es el consumo más alto.
 *
 * El "peor" consumo es el máximo entre todos los servidores: si ese está bien, están todos
 * bien; y si está mal, el panel ya justifica ir a mirar la pantalla del módulo.
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object>} Conteos y picos de consumo.
 */
const resumenServidores = async (models) => {
    const { Servidor, ServidorMetrica, ServidorIncidente } = models;

    const servidores = await Servidor.findAll({
        where: { activo: true },
        attributes: ['id', 'estado', 'monitorea'],
        raw: true,
    });

    const conteo = { total: servidores.length, online: 0, offline: 0, sinDatos: 0 };
    for (const s of servidores) {
        if (s.estado === 'online') conteo.online++;
        else if (s.estado === 'offline') conteo.offline++;
        else conteo.sinDatos++;
    }

    if (!servidores.length) {
        return { ...conteo, incidentes: 0, picoCpu: null, picoRam: null, picoDisco: null };
    }

    const ids = servidores.map(s => s.id);
    const incidentes = await ServidorIncidente.count({
        where: { servidorId: { [Op.in]: ids }, resueltoAt: null },
    });

    // Pico de consumo: solo se miran las métricas de los últimos 10 minutos para no mostrar
    // el valor congelado de un servidor que dejó de reportar hace horas.
    const desde = new Date(Date.now() - 10 * 60 * 1000);
    const [picos] = await ServidorMetrica.findAll({
        where: { servidorId: { [Op.in]: ids }, createdAt: { [Op.gte]: desde } },
        attributes: [
            [ServidorMetrica.sequelize.fn('MAX', ServidorMetrica.sequelize.col('cpu')), 'cpu'],
            [ServidorMetrica.sequelize.fn('MAX', ServidorMetrica.sequelize.col('ram')), 'ram'],
            [ServidorMetrica.sequelize.fn('MAX', ServidorMetrica.sequelize.col('disco')), 'disco'],
        ],
        raw: true,
    });

    return {
        ...conteo,
        incidentes,
        picoCpu: picos?.cpu != null ? Number(picos.cpu) : null,
        picoRam: picos?.ram != null ? Number(picos.ram) : null,
        picoDisco: picos?.disco != null ? Number(picos.disco) : null,
    };
};

/**
 * Resumen de los sitios web: estados de disponibilidad y vencimientos próximos.
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object>} Conteos por estado y por vencimiento.
 */
const resumenSitios = async (models) => {
    const { SitioWeb, SitioIncidente } = models;

    const sitios = await SitioWeb.findAll({
        where: { activo: true },
        attributes: ['id', 'estado', 'dominioVenceAt', 'tlsVenceAt'],
        raw: true,
    });

    const [diasDominio, diasTls] = await Promise.all([
        getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_DOMINIO'),
        getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_TLS'),
    ]);

    const r = {
        total: sitios.length, online: 0, sinMarcador: 0, offline: 0, sinChequear: 0,
        dominioPorVencer: 0, dominioVencido: 0, tlsPorVencer: 0, tlsVencido: 0,
        incidentes: 0,
    };

    for (const s of sitios) {
        if (s.estado === 'online') r.online++;
        else if (s.estado === 'sin_marcador') r.sinMarcador++;
        else if (s.estado === 'offline') r.offline++;
        else r.sinChequear++;

        const dom = estadoVencimiento(s.dominioVenceAt, diasDominio);
        if (dom.estado === 'por_vencer') r.dominioPorVencer++;
        else if (dom.estado === 'vencido') r.dominioVencido++;

        const tls = estadoVencimiento(s.tlsVenceAt, diasTls);
        if (tls.estado === 'por_vencer') r.tlsPorVencer++;
        else if (tls.estado === 'vencido') r.tlsVencido++;
    }

    if (sitios.length) {
        r.incidentes = await SitioIncidente.count({
            where: { sitioId: { [Op.in]: sitios.map(s => s.id) }, resueltoAt: null },
        });
    }
    return r;
};

/**
 * Resumen del módulo para el panel. Cada mitad se calcula SOLO si el usuario puede verla;
 * la otra viaja null y el panel no la dibuja.
 * @param {object} models - Modelos de la app.
 * @param {{verServidores: boolean, verSitios: boolean}} permisos - Qué puede ver quien mira.
 * @returns {Promise<{servidores: object|null, sitios: object|null}|null>} Resumen o null si no ve nada.
 */
export const resumenMantenimiento = async (models, { verServidores, verSitios }) => {
    const [servidores, sitios] = await Promise.all([
        verServidores && models.Servidor ? resumenServidores(models) : Promise.resolve(null),
        verSitios && models.SitioWeb ? resumenSitios(models) : Promise.resolve(null),
    ]);
    if (!servidores && !sitios) return null;
    return { servidores, sitios };
};
