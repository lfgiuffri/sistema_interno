/**
 * Estadísticas anuales del panel (../analisis_app_php/03 §4.6–4.8):
 *  - Serie mensual abonos vs proyectos (cobrado CONGELADO: facturaciones vigentes y
 *    cobranzas cobradas).
 *  - Facturación de abonos por servicio: top 7 + serie "Otros" (la paleta tiene 8).
 *  - Facturación por área: abonos vía facturación→servicio→área, proyectos vía
 *    cobranza→proyecto→servicio→área; lo inclasificable cae en la cubeta "Sin área"
 *    (visible solo con movimiento, al final). Matriz área × 12 meses.
 * El MISMO año gobierna los tres bloques (selector único).
 */

import { Op } from 'sequelize';

/** Serie de 12 ceros (enero..diciembre). */
const doce = () => Array.from({ length: 12 }, () => 0);

/**
 * Años con movimiento (facturaciones vigentes ∪ cobranzas cobradas) + pedido + actual.
 * @param {object} models - Modelos de la app.
 * @param {number} anio - Año pedido.
 * @returns {Promise<number[]>} Años ordenados.
 */
export const aniosDisponibles = async (models, anio) => {
    const { Facturacion, Cobranza } = models;
    const [f, c] = await Promise.all([
        Facturacion
            ? Facturacion.findAll({ attributes: [[Facturacion.sequelize.fn('DISTINCT', Facturacion.sequelize.col('anio')), 'anio']], where: { anuladaAt: null }, raw: true })
            : [],
        Cobranza
            ? Cobranza.findAll({ attributes: [[Cobranza.sequelize.fn('DISTINCT', Cobranza.sequelize.col('anio')), 'anio']], where: { cobrado: true }, raw: true })
            : []
    ]);
    return [...new Set([
        ...f.map(r => Number(r.anio)), ...c.map(r => Number(r.anio)),
        Number(anio), new Date().getFullYear()
    ])].sort();
};

/**
 * Serie mensual del año: abonos (facturaciones vigentes) vs proyectos (cobranzas cobradas).
 * @param {object} models - Modelos de la app.
 * @param {number} anio - Año.
 * @returns {Promise<{abonos: number[], proyectos: number[], totalAbonos: number, totalProyectos: number}>}
 */
export const serieMensual = async (models, anio) => {
    const { Facturacion, Cobranza } = models;
    const abonos = doce(), proyectos = doce();

    const [filasF, filasC] = await Promise.all([
        Facturacion.findAll({
            attributes: ['mes', [Facturacion.sequelize.fn('SUM', Facturacion.sequelize.col('montoPesos')), 'total']],
            where: { anio, anuladaAt: null },
            group: ['mes'],
            raw: true
        }),
        Cobranza.findAll({
            attributes: ['mes', [Cobranza.sequelize.fn('SUM', Cobranza.sequelize.col('montoPesos')), 'total']],
            where: { anio, cobrado: true },
            group: ['mes'],
            raw: true
        })
    ]);
    for (const f of filasF) abonos[Number(f.mes) - 1] = Number(f.total) || 0;
    for (const c of filasC) proyectos[Number(c.mes) - 1] = Number(c.total) || 0;

    return {
        abonos,
        proyectos,
        totalAbonos: abonos.reduce((a, b) => a + b, 0),
        totalProyectos: proyectos.reduce((a, b) => a + b, 0)
    };
};

/**
 * Recorta a top N series por total y agrupa el resto en "Otros" (regla del legado: 7 + 1).
 * @param {Array<{label: string, total: number, data: number[]}>} series - Series crudas.
 * @param {string} etiquetaOtros - 'Otros' | 'Otras'.
 * @returns {Array<{label: string, slot: string|null, total: number, data: number[]}>}
 */
const topConOtros = (series, etiquetaOtros) => {
    const orden = [...series].filter(s => s.total > 0).sort((a, b) => b.total - a.total);
    const top = orden.slice(0, 7).map(s => ({ ...s, slot: null }));
    const resto = orden.slice(7);
    if (resto.length) {
        const data = doce();
        for (const s of resto) s.data.forEach((v, i) => { data[i] += v; });
        top.push({ label: etiquetaOtros, slot: 'otros', total: resto.reduce((a, s) => a + s.total, 0), data });
    }
    return top;
};

/**
 * Facturación de ABONOS por servicio del año (usa el snapshot servicioId de la
 * facturación): totales + serie mensual, top 7 + "Otros".
 * @param {object} models - Modelos de la app.
 * @param {number} anio - Año.
 * @returns {Promise<Array<{label: string, slot: string|null, total: number, data: number[]}>>}
 */
export const porServicio = async (models, anio) => {
    const { Facturacion, Servicio } = models;
    const filas = await Facturacion.findAll({
        attributes: ['servicioId', 'mes', [Facturacion.sequelize.fn('SUM', Facturacion.sequelize.col('montoPesos')), 'total']],
        where: { anio, anuladaAt: null },
        group: ['servicioId', 'mes'],
        raw: true
    });
    if (!filas.length) return [];

    const ids = [...new Set(filas.map(f => f.servicioId).filter(Boolean))];
    const servicios = ids.length
        ? await Servicio.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'nombre'], paranoid: false, raw: true })
        : [];
    const nombrePor = Object.fromEntries(servicios.map(s => [s.id, s.nombre]));

    const porId = new Map();
    for (const f of filas) {
        const key = f.servicioId ?? 0;
        if (!porId.has(key)) porId.set(key, { label: nombrePor[key] ?? 'Sin servicio', total: 0, data: doce() });
        const s = porId.get(key);
        const v = Number(f.total) || 0;
        s.total += v;
        s.data[Number(f.mes) - 1] += v;
    }
    return topConOtros([...porId.values()], 'Otros');
};

/**
 * Facturación por ÁREA del año: abonos (facturación→servicio→área) + proyectos
 * (cobranza cobrada→proyecto→servicio→área). Cubeta "Sin área" al final.
 * @param {object} models - Modelos de la app.
 * @param {number} anio - Año.
 * @returns {Promise<Array<{label: string, slot: string|null, total: number, data: number[]}>>}
 */
export const porArea = async (models, anio) => {
    const { Facturacion, Cobranza, Proyecto, Servicio, Area } = models;

    // Mapa servicio → área (incluye eliminados: el histórico no pierde clasificación).
    const servicios = await Servicio.findAll({ attributes: ['id', 'areaId'], paranoid: false, raw: true });
    const areaDeServicio = Object.fromEntries(servicios.map(s => [s.id, s.areaId]));
    const areas = await Area.findAll({ attributes: ['id', 'nombre', 'orden'], paranoid: false, raw: true });
    const nombreArea = Object.fromEntries(areas.map(a => [a.id, a.nombre]));

    const acum = new Map(); // areaId (0 = Sin área) → { label, total, data[12] }
    const sumar = (areaId, mes, monto) => {
        const key = areaId || 0;
        if (!acum.has(key)) acum.set(key, { label: key ? (nombreArea[key] ?? 'Sin área') : 'Sin área', total: 0, data: doce() });
        const a = acum.get(key);
        a.total += monto;
        a.data[mes - 1] += monto;
    };

    const [filasF, filasC] = await Promise.all([
        Facturacion.findAll({
            attributes: ['servicioId', 'mes', [Facturacion.sequelize.fn('SUM', Facturacion.sequelize.col('montoPesos')), 'total']],
            where: { anio, anuladaAt: null },
            group: ['servicioId', 'mes'],
            raw: true
        }),
        Cobranza.findAll({
            attributes: ['mes', [Cobranza.sequelize.fn('SUM', Cobranza.sequelize.col('montoPesos')), 'total'], [Cobranza.sequelize.col('proyecto.servicioId'), 'servicioId']],
            where: { anio, cobrado: true },
            include: [{ model: Proyecto, attributes: [], paranoid: false }],
            group: ['proyecto.servicioId', 'mes'],
            raw: true
        })
    ]);

    for (const f of filasF) sumar(f.servicioId ? areaDeServicio[f.servicioId] : 0, Number(f.mes), Number(f.total) || 0);
    for (const c of filasC) sumar(c.servicioId ? areaDeServicio[c.servicioId] : 0, Number(c.mes), Number(c.total) || 0);

    // Con movimiento; "Sin área" al final; el resto por total desc con top 7 + "Otras".
    const sinArea = acum.get(0);
    acum.delete(0);
    const resultado = topConOtros([...acum.values()], 'Otras');
    if (sinArea && sinArea.total > 0) resultado.push({ ...sinArea, slot: 'sin-area' });
    return resultado;
};
