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
// El sueldo vigente de un mes tiene reglas propias (ver `sueldosPorEmpleado`): se importa la
// función del módulo que la define en vez de reimplementarla, para que este gráfico no pueda
// decir un número distinto al de la pantalla de sueldos.
import { salarioEnMesPuro } from '../../sueldos/services/sueldo.service.js';

/** Serie de 12 ceros (enero..diciembre). */
const doce = () => Array.from({ length: 12 }, () => 0);

/**
 * Años con movimiento (facturaciones vigentes ∪ cobranzas cobradas ∪ sueldos) + pedido + actual.
 * @param {object} models - Modelos de la app.
 * @param {number} anio - Año pedido.
 * @returns {Promise<number[]>} Años ordenados.
 */
export const aniosDisponibles = async (models, anio) => {
    const { Facturacion, Cobranza, SueldoActualizacion } = models;
    const [f, c, s] = await Promise.all([
        Facturacion
            ? Facturacion.findAll({ attributes: [[Facturacion.sequelize.fn('DISTINCT', Facturacion.sequelize.col('anio')), 'anio']], where: { anuladaAt: null }, raw: true })
            : [],
        Cobranza
            ? Cobranza.findAll({ attributes: [[Cobranza.sequelize.fn('DISTINCT', Cobranza.sequelize.col('anio')), 'anio']], where: { cobrado: true }, raw: true })
            : [],
        // El mismo selector gobierna ahora el gráfico de sueldos, así que un año con
        // actualizaciones de sueldo pero sin facturación tiene que poder elegirse.
        SueldoActualizacion
            ? SueldoActualizacion.findAll({ attributes: [[SueldoActualizacion.sequelize.fn('DISTINCT', SueldoActualizacion.sequelize.fn('YEAR', SueldoActualizacion.sequelize.col('fecha'))), 'anio']], raw: true })
            : []
    ]);
    return [...new Set([
        ...f.map(r => Number(r.anio)), ...c.map(r => Number(r.anio)), ...s.map(r => Number(r.anio)),
        Number(anio), new Date().getFullYear()
    ])].filter(Boolean).sort();
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

/**
 * Progreso mensual del sueldo de cada empleado durante el año (una línea por persona).
 *
 * El valor de cada mes NO se lee de una tabla: sale de `salarioEnMesPuro`, la misma función
 * que usan el listado de sueldos y la planificación. Es deliberado — esa función tiene reglas
 * que no son obvias (vale el último registro con fecha <= FIN de mes, desempata fecha DESC e
 * id DESC, y el primer registro histórico se extiende hacia atrás), y reescribirlas acá
 * garantizaba que este gráfico dijera un número distinto al de la pantalla de sueldos.
 *
 * Dos recortes para no dibujar lo que no pasó:
 *  - **Antes del ingreso va `null`**, no el sueldo extendido hacia atrás. Esa extensión es
 *    correcta para «qué sueldo tenía registrado» pero mentiría acá: en enero, alguien que
 *    entró en mayo no cobraba nada. Con null la línea arranca cuando arrancó la persona.
 *  - **Los meses futuros van `null`** si el año es el actual: repetir el sueldo de hoy hasta
 *    diciembre es una proyección, y un gráfico de progreso no proyecta.
 *
 * Solo empleados ACTIVOS: la ficha no tiene fecha de egreso, así que de uno dado de baja no
 * se sabe CUÁNDO dejó de cobrar y su línea quedaría plana todo el año, afirmando un sueldo
 * que no se pagó. Es preferible no dibujarlo a dibujarlo mal.
 * @param {object} models - Modelos de la app.
 * @param {number} anio - Año.
 * @returns {Promise<Array<{label: string, data: Array<number|null>, actual: number}>>} Una serie por empleado.
 */
export const sueldosPorEmpleado = async (models, anio) => {
    const { Empleado, SueldoActualizacion } = models;
    if (!Empleado || !SueldoActualizacion) return [];

    const empleados = await Empleado.findAll({
        where: { activo: true },
        attributes: ['id', 'nombre', 'sueldo', 'fechaIngreso'],
        raw: true,
    });
    if (!empleados.length) return [];

    // Un solo findAll y agrupado en memoria: son decenas de filas y así se evita el N+1 de
    // pedir el historial empleado por empleado.
    const filas = await SueldoActualizacion.findAll({
        where: { empleadoId: { [Op.in]: empleados.map(e => e.id) } },
        attributes: ['id', 'empleadoId', 'fecha', 'sueldoNuevo'],
        raw: true,
    });
    const historiales = new Map();
    for (const f of filas) {
        if (!historiales.has(f.empleadoId)) historiales.set(f.empleadoId, []);
        historiales.get(f.empleadoId).push(f);
    }

    const hoy = new Date();
    const mesTope = anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12;

    return empleados
        .map((e) => {
            const historial = historiales.get(e.id) ?? [];
            // Mes de ingreso dentro de ESTE año; si entró antes, cuenta desde enero.
            const ingreso = e.fechaIngreso ? String(e.fechaIngreso).slice(0, 7) : null;
            const anioIngreso = ingreso ? Number(ingreso.slice(0, 4)) : null;
            const mesDesde = (anioIngreso === null || anioIngreso < anio)
                ? 1
                : (anioIngreso > anio ? 13 : Number(ingreso.slice(5, 7)));

            const data = Array.from({ length: 12 }, (_, i) => {
                const mes = i + 1;
                if (mes < mesDesde || mes > mesTope) return null;
                return salarioEnMesPuro(historial, e.sueldo, anio, mes);
            });

            const conValor = data.filter(v => v !== null);
            return {
                empleadoId: e.id,
                // `nombre` del empleado es el nombre COMPLETO: la ficha no separa apellido.
                label: String(e.nombre).trim(),
                data,
                // El último sueldo del año que se dibuja: ordena la leyenda y da el dato que
                // más se mira («cuánto cobra hoy») sin tener que leerlo del gráfico.
                actual: conValor.length ? Number(conValor[conValor.length - 1]) : 0,
            };
        })
        // Sin ningún mes dibujable (ingresó el año que viene) no aporta una línea vacía.
        .filter(s => s.data.some(v => v !== null))
        // De mayor a menor: con nueve líneas encimadas, que la leyenda siga al orden de los
        // sueldos es lo que hace que se pueda leer cuál es cuál.
        .sort((a, b) => b.actual - a.actual);
};
