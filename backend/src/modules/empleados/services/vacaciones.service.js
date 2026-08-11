/**
 * Motor de vacaciones — réplica EXACTA del legado (../analisis_app_php/04 §3.3):
 *  1. Cada año otorga N días (override por año en vacacion_asignaciones, si no
 *     `empleados.vacDiasAnuales`).
 *  2. Los días de un año se usan ese año Y el siguiente; a año+2 vencen (se acumula
 *     UN solo año).
 *  3. Se consumen de atrás para adelante: primero el bucket del año anterior.
 *  4. Freelance no otorga nada (las filas históricas quedan, solo dejan de informarse).
 *  - Días CORRIDOS inclusive (sin hábiles/feriados). Una toma que cruza el 1/1 se imputa
 *    ENTERA al año de fechaDesde. Sin prorrateo por antigüedad.
 * Mejoras del PRD §6.4: validación de solapamiento de períodos; el sobregiro no se
 * persiste — la simulación lo recalcula siempre (cargas fuera de orden se reflejan solas).
 */

import { CATEGORIAS_SIN_VACACIONES } from '../models/Empleado.js';

/**
 * ¿La categoría del empleado genera vacaciones?
 * @param {object} empleado - Empleado ({ categoria }).
 * @returns {boolean} true si genera.
 */
export const usaVacaciones = (empleado) => !CATEGORIAS_SIN_VACACIONES.includes(empleado.categoria);

/**
 * Días corridos INCLUSIVE entre dos fechas ISO (hasta < desde → 0).
 * @param {string} desde - 'YYYY-MM-DD'.
 * @param {string} hasta - 'YYYY-MM-DD'.
 * @returns {number} Cantidad de días.
 */
export const diasCorridos = (desde, hasta) => {
    if (!desde || !hasta || hasta < desde) return 0;
    const ms = Date.UTC(...hasta.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)))
        - Date.UTC(...desde.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
    return Math.round(ms / 86400000) + 1;
};

/**
 * Otorgamientos por año: desde el primer año con actividad (ingreso, primera toma o
 * primer override — el menor) hasta `hastaAnio`. Sin nada → solo `hastaAnio`.
 * @param {object} empleado - Empleado ({ fechaIngreso, vacDiasAnuales }).
 * @param {object[]} asignaciones - Overrides ({ anio, dias }).
 * @param {object[]} tomas - Tomas ({ fechaDesde }).
 * @param {number} hastaAnio - Año tope (incluido).
 * @returns {Record<number, number>} anio → días otorgados.
 */
export const grants = (empleado, asignaciones, tomas, hastaAnio) => {
    const overrides = Object.fromEntries(asignaciones.map(a => [Number(a.anio), Number(a.dias)]));
    const candidatos = [];
    if (empleado.fechaIngreso) candidatos.push(Number(String(empleado.fechaIngreso).slice(0, 4)));
    if (tomas.length) candidatos.push(Math.min(...tomas.map(t => Number(String(t.fechaDesde).slice(0, 4)))));
    if (asignaciones.length) candidatos.push(Math.min(...asignaciones.map(a => Number(a.anio))));

    const firstYear = Math.min(candidatos.length ? Math.min(...candidatos) : hastaAnio, hastaAnio);
    const result = {};
    for (let y = firstYear; y <= hastaAnio; y++) {
        result[y] = overrides[y] ?? Number(empleado.vacDiasAnuales) ?? 0;
    }
    return result;
};

/**
 * Simulación año por año (algoritmo del legado, calcado):
 *  - suma el grant del año; vence todo bucket anterior a (año − 1);
 *  - consume las tomas del año (por año de fechaDesde, orden fechaDesde) primero del
 *    bucket del año anterior y después del propio; el resto es sobregiro de la toma.
 * @param {Record<number, number>} grantsPorAnio - anio → días.
 * @param {object[]} tomas - Tomas ({ id, fechaDesde, fechaHasta, dias, observacion }).
 * @param {number} hastaAnio - Año final de la simulación.
 * @returns {{buckets: Record<number, number>, tomas: object[], sobregiroTotal: number}}
 */
export const simular = (grantsPorAnio, tomas, hastaAnio) => {
    const anios = Object.keys(grantsPorAnio).map(Number).sort((a, b) => a - b);
    if (!anios.length) return { buckets: {}, tomas: [], sobregiroTotal: 0 };

    const buckets = {};
    const tomasOut = [];
    let sobregiroTotal = 0;

    const tomasPorAnio = {};
    for (const t of [...tomas].sort((a, b) => String(a.fechaDesde).localeCompare(String(b.fechaDesde)))) {
        const y = Number(String(t.fechaDesde).slice(0, 4));
        (tomasPorAnio[y] ??= []).push(t);
    }

    for (let y = anios[0]; y <= hastaAnio; y++) {
        buckets[y] = (buckets[y] || 0) + (grantsPorAnio[y] || 0);
        // Vencimiento: todo bucket más viejo que y−1 se pierde.
        for (const gy of Object.keys(buckets).map(Number)) {
            if (gy < y - 1) buckets[gy] = 0;
        }
        for (const toma of (tomasPorAnio[y] || [])) {
            let resto = Number(toma.dias);
            // Primero el bucket del año anterior, después el del año.
            for (const bucketY of [y - 1, y]) {
                const disp = buckets[bucketY] || 0;
                const usa = Math.min(disp, resto);
                if (usa > 0) { buckets[bucketY] = disp - usa; resto -= usa; }
            }
            const sobregiro = Math.max(0, resto);
            sobregiroTotal += sobregiro;
            tomasOut.push({ ...toma, sobregiro });
        }
    }
    return { buckets, tomas: tomasOut, sobregiroTotal };
};

/**
 * Estado de vacaciones de un empleado al año `hastaAnio` (default: actual).
 * @param {object} empleado - Empleado.
 * @param {object[]} asignaciones - Overrides del empleado.
 * @param {object[]} tomasRaw - Tomas del empleado (POJOs).
 * @param {number} [hastaAnio] - Año de corte.
 * @returns {object} { aplica, dispAnterior, dispActual, disponible, venceAnterior,
 *                     venceActual, tomadosAnio, tomas, sobregiro }.
 */
export const estadoVacaciones = (empleado, asignaciones, tomasRaw, hastaAnio = new Date().getFullYear()) => {
    if (!usaVacaciones(empleado)) return { aplica: false };

    const g = grants(empleado, asignaciones, tomasRaw, hastaAnio);
    const sim = simular(g, tomasRaw, hastaAnio);

    const dispAnterior = Math.max(0, sim.buckets[hastaAnio - 1] || 0);
    const dispActual = Math.max(0, sim.buckets[hastaAnio] || 0);
    const tomadosAnio = sim.tomas
        .filter(t => String(t.fechaDesde).startsWith(String(hastaAnio)))
        .reduce((acc, t) => acc + Number(t.dias), 0);

    return {
        aplica: true,
        dispAnterior,
        dispActual,
        disponible: dispAnterior + dispActual,
        venceAnterior: `31/12/${hastaAnio}`,
        venceActual: `31/12/${hastaAnio + 1}`,
        tomadosAnio,
        // Más nuevas primero para el render.
        tomas: [...sim.tomas].sort((a, b) => String(b.fechaDesde).localeCompare(String(a.fechaDesde))),
        sobregiro: sim.sobregiroTotal,
        grants: g
    };
};

/**
 * Disponible A LA FECHA de inicio de una toma nueva: simula solo con las tomas
 * anteriores a `fechaDesde` y devuelve bucket(Y−1) + bucket(Y).
 * (Regla del legado: las tomas posteriores ya cargadas no restan acá; el sobregiro
 * que generen se recalcula y se muestra en la simulación.)
 * @param {object} empleado - Empleado.
 * @param {object[]} asignaciones - Overrides.
 * @param {object[]} tomas - Todas las tomas.
 * @param {string} fechaDesde - Fecha de inicio propuesta.
 * @returns {number} Días disponibles a esa fecha.
 */
export const disponibleAl = (empleado, asignaciones, tomas, fechaDesde) => {
    const anio = Number(String(fechaDesde).slice(0, 4));
    const previas = tomas.filter(t => String(t.fechaDesde) < String(fechaDesde));
    const g = grants(empleado, asignaciones, previas, anio);
    const sim = simular(g, previas, anio);
    return Math.max(0, sim.buckets[anio - 1] || 0) + Math.max(0, sim.buckets[anio] || 0);
};

/**
 * ¿El período [desde, hasta] se solapa con alguna toma existente? (mejora PRD §6.4;
 * el legado no lo validaba).
 * @param {object[]} tomas - Tomas existentes.
 * @param {string} desde - Inicio propuesto.
 * @param {string} hasta - Fin propuesto.
 * @returns {object|null} La toma que se solapa, o null.
 */
export const tomaSolapada = (tomas, desde, hasta) =>
    tomas.find(t => String(t.fechaDesde) <= hasta && String(t.fechaHasta) >= desde) || null;
