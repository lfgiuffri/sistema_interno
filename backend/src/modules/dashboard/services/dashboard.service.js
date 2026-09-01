/**
 * Service del módulo `dashboard` — arma los bloques del panel.
 *
 * Cada bloque se calcula SOLO si el usuario tiene la capability correspondiente
 * (el legado calculaba todo y ocultaba al renderizar — acá se invierte, PRD §6.9).
 *
 * Dos superficies separadas: `armarDashboard` (el panel: estado actual del negocio) y
 * `armarEstadisticas` (los gráficos anuales de facturación, pantalla propia).
 */

import { Op } from 'sequelize';
import { getRoleCapabilities } from '../../../kernel/index.js';
import {
    getConfigAbonos, precioEnPesos, estadoActualizacion, SQL_DIAS_ACTUALIZACION
} from '../../abonos/services/abono.service.js';
import { aniosDisponibles, serieMensual, porServicio, porArea } from './estadisticas.service.js';

/** Ventana de "próximo a entregar" en días para proyectos (regla del legado). */
const VENTANA_PROYECTOS = 5;
/** Estados que cierran un proyecto (sin alertas de entrega). */
const ESTADOS_CERRADOS = ['finalizado', 'finalizado_incompleto'];

/**
 * ¿El set de capabilities habilita esta? (comodín incluido).
 * @param {string[]} caps - Capabilities del rol.
 * @param {string} cap - Capability requerida.
 * @returns {boolean}
 */
const puede = (caps, cap) => caps.includes('*') || caps.includes(cap);

/**
 * Bloque de abonos: totales + alertas de actualización (vencidos y próximos ≤ 30 días).
 * @param {object} models - Modelos de la app.
 * @param {{cotizacion: number, redondeo: number}} config - Config vigente.
 * @returns {Promise<object>} { activos, totalPesos, vencidos[], proximos[] }.
 */
const bloqueAbonos = async (models, config) => {
    const { Abono } = models;
    // El fragmento y la clasificación salen del módulo abonos: el panel y el listado tienen
    // que decir lo MISMO sobre el mismo abono.
    const SQL_DIAS = SQL_DIAS_ACTUALIZACION;

    const rows = await Abono.findAll({
        where: { activo: true },
        include: [
            { model: models.Cliente, attributes: ['id', 'nombre'] },
            { model: models.Servicio, attributes: ['id', 'nombre'] },
        ],
        attributes: { include: [[Abono.sequelize.literal(SQL_DIAS), 'diasParaActualizar']] },
        order: [Abono.sequelize.literal('diasParaActualizar ASC')],
    });

    let totalPesos = 0;
    const vencidos = [], proximos = [];
    for (const r of rows) {
        const abono = r.toJSON();
        totalPesos += precioEnPesos(abono, config.cotizacion, config.redondeo);
        const dias = abono.diasParaActualizar;
        if (dias === null || dias === undefined) continue;
        const item = {
            id: abono.id,
            cliente: abono.cliente?.nombre,
            servicio: abono.servicio?.nombre,
            descripcion: abono.descripcion,
            moneda: abono.moneda,
            precio: Number(abono.precio),
            precioPesos: precioEnPesos(abono, config.cotizacion, config.redondeo),
            fechaUltimaActualizacion: abono.fechaUltimaActualizacion,
            dias,
        };
        const estado = estadoActualizacion(dias);
        if (estado === 'vencido') vencidos.push(item);
        else if (estado === 'proximo') proximos.push(item);
    }

    return { activos: rows.length, totalPesos, vencidos, proximos };
};

/**
 * Bloque de facturación del mes corriente (parte abonos): lo facturado (congelado) y lo
 * pendiente (abonos activos sin facturación vigente este mes, al dólar de hoy).
 * @param {object} models - Modelos de la app.
 * @param {{cotizacion: number, redondeo: number}} config - Config vigente.
 * @returns {Promise<object>} { anio, mes, abonosFacturado, abonosPendiente }.
 */
const bloqueFacturacionMes = async (models, config) => {
    const { Abono, Facturacion } = models;
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;

    const abonosFacturado = Number(await Facturacion.sum('montoPesos', {
        where: { anio, mes, anuladaAt: null }
    })) || 0;

    const facturadas = await Facturacion.findAll({
        where: { anio, mes, anuladaAt: null }, attributes: ['abonoId'], raw: true
    });
    const yaSet = new Set(facturadas.map(f => f.abonoId));

    const activos = await Abono.findAll({ where: { activo: true }, raw: true });
    let abonosPendiente = 0;
    for (const abono of activos) {
        if (!yaSet.has(abono.id)) abonosPendiente += precioEnPesos(abono, config.cotizacion, config.redondeo);
    }

    return { anio, mes, abonosFacturado, abonosPendiente };
};

/**
 * Bloque de proyectos: alertas de entrega (vencidos y próximos ≤ 5 días, no cerrados).
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object>} { abiertos, vencidos[], proximos[] }.
 */
const bloqueProyectos = async (models) => {
    const { Proyecto, Op: _ } = models;
    const { Op } = await import('sequelize');
    const SQL_DIAS = 'DATEDIFF(`proyectos`.`fechaEstimadaEntrega`, CURDATE())';

    const rows = await Proyecto.findAll({
        where: { estado: { [Op.notIn]: ESTADOS_CERRADOS } },
        include: [{ model: models.Cliente, attributes: ['id', 'nombre'] }],
        attributes: { include: [[Proyecto.sequelize.literal(SQL_DIAS), 'diasParaEntrega']] },
        order: [Proyecto.sequelize.literal('diasParaEntrega ASC')],
    });

    const vencidos = [], proximos = [];
    for (const r of rows) {
        const p = r.toJSON();
        const dias = p.diasParaEntrega;
        if (dias === null || dias === undefined) continue;
        const item = {
            id: p.id, nombre: p.nombre, cliente: p.cliente?.nombre,
            estado: p.estado, fechaEstimadaEntrega: p.fechaEstimadaEntrega, dias,
        };
        if (dias < 0) vencidos.push(item);
        else if (dias <= VENTANA_PROYECTOS) proximos.push(item);
    }
    return { abiertos: rows.length, vencidos, proximos };
};

/**
 * Parte proyectos de la facturación del mes: cobranzas cobradas (congeladas) y
 * pendientes del mes (al dólar de hoy).
 * @param {object} models - Modelos de la app.
 * @param {{cotizacion: number}} config - Config vigente.
 * @returns {Promise<{proyectosFacturado: number, proyectosPendiente: number}>}
 */
const facturacionMesProyectos = async (models, config) => {
    const { Cobranza } = models;
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;

    const proyectosFacturado = Number(await Cobranza.sum('montoPesos', {
        where: { anio, mes, cobrado: true }
    })) || 0;
    const pendientesUsd = Number(await Cobranza.sum('montoUsd', {
        where: { anio, mes, cobrado: false }
    })) || 0;

    return { proyectosFacturado, proyectosPendiente: pendientesUsd * config.cotizacion };
};

/**
 * Arma el panel según las capabilities del usuario. Los bloques sin permiso viajan null
 * y NO se calculan.
 *
 * El panel es "qué está pasando ahora": totales, alertas e infraestructura. Los gráficos
 * anuales de facturación viven en su propia pantalla (`armarEstadisticas`) y el análisis de
 * tareas en la suya, así que abrir el panel no paga esas consultas.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario que mira ({ id, roleId }).
 * @returns {Promise<object>} Bloques del panel (null los no permitidos).
 */
export const armarDashboard = async (models, user) => {
    const caps = await getRoleCapabilities(models, 'default', user.roleId);
    const config = await getConfigAbonos(models);

    const verAbonos = puede(caps, 'abonos:read');
    const verFacturaciones = puede(caps, 'facturaciones:read');
    const verProyectos = puede(caps, 'proyectos:read') && !!models.Proyecto;
    const verCobranzas = puede(caps, 'cobranzas:read') && !!models.Cobranza;
    const verServidores = puede(caps, 'servidores:read') && !!models.Servidor;
    const verSitios = puede(caps, 'sitios:read') && !!models.SitioWeb;

    // Los bloques de otros módulos se importan acá (y no arriba) para no acoplar el boot:
    // dashboard funciona aunque mantenimiento no esté montado.
    //
    // El bloque «Tareas del equipo» YA NO vive acá (2026-08-25): se mudó a la pantalla
    // **Análisis de tareas** del módulo tareas. El motivo es de costo: el tiempo promedio de
    // trabajo se calcula leyendo la bitácora completa de las tareas asignadas, y el Panel se
    // autorefresca cada minuto para dejarlo en un monitor.
    const mantenimientoPromise = (verServidores || verSitios)
        ? import('../../mantenimiento/services/resumen.service.js')
            .then(m => m.resumenMantenimiento(models, { verServidores, verSitios }))
        : Promise.resolve(null);

    const [abonos, facturacionMes, proyectos, factProyectos, mantenimiento] = await Promise.all([
        verAbonos ? bloqueAbonos(models, config) : Promise.resolve(null),
        (verAbonos && verFacturaciones) ? bloqueFacturacionMes(models, config) : Promise.resolve(null),
        verProyectos ? bloqueProyectos(models) : Promise.resolve(null),
        verCobranzas ? facturacionMesProyectos(models, config) : Promise.resolve(null),
        mantenimientoPromise,
    ]);

    return {
        cotizacion: config.cotizacion,
        abonos,
        facturacionMes: (facturacionMes || factProyectos)
            ? { ...(facturacionMes || {}), ...(factProyectos || {}) }
            : null,
        proyectos,
        mantenimiento,
    };
};

/**
 * Arma las estadísticas anuales de facturación (pantalla propia). Los tres gráficos
 * comparten el mismo `anio` (selector único) y cada uno viaja null si el rol no puede ver
 * TODAS las secciones cuyos datos muestra (regla del legado §4.1 en capabilities):
 * mensual = facturaciones + cobranzas · por servicio = facturaciones + servicios ·
 * por área = facturaciones + cobranzas + áreas.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario que mira ({ id, roleId }).
 * @param {number} [anio] - Año de las series (default: actual).
 * @returns {Promise<object>} { anio, anios, mensual, servicios, areas }.
 */
export const armarEstadisticas = async (models, user, anio) => {
    const caps = await getRoleCapabilities(models, 'default', user.roleId);
    const anioStats = (Number(anio) >= 2000 && Number(anio) <= 2100) ? Number(anio) : new Date().getFullYear();

    const verFacturaciones = puede(caps, 'facturaciones:read');
    const verCobranzas = puede(caps, 'cobranzas:read') && !!models.Cobranza;
    const verChartMensual = verFacturaciones && verCobranzas;
    const verChartServicio = verFacturaciones && puede(caps, 'servicios:read');
    const verChartAreas = verFacturaciones && verCobranzas && puede(caps, 'areas:read');

    const [mensual, servicios, areas, anios] = await Promise.all([
        verChartMensual ? serieMensual(models, anioStats) : Promise.resolve(null),
        verChartServicio ? porServicio(models, anioStats) : Promise.resolve(null),
        verChartAreas ? porArea(models, anioStats) : Promise.resolve(null),
        aniosDisponibles(models, anioStats),
    ]);

    return { anio: anioStats, anios, mensual, servicios, areas };
};
