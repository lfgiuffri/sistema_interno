/**
 * Velocidad de los sitios: series por día, mes y año.
 *
 * DOS fuentes, y la distinción es el punto de todo esto:
 *  - **Detalle** (`sitio_chequeos`): un registro cada 5 minutos, se purga a los 30 días.
 *  - **Rollup diario** (`sitio_velocidad_dia`): una fila por vista y día, **permanente**.
 *
 * Sin el rollup, «¿el sitio está más lento que el año pasado?» no tendría respuesta: el
 * detalle de hace un año ya no existe. Y con SOLO el detalle, el día de hoy quedaría afuera
 * hasta que corra la tarea nocturna. Así que el día se responde con las dos: rollup para los
 * días cerrados y detalle para el día en curso.
 *
 * El promedio ignora los chequeos que NO respondieron: un timeout de 12 s no es «12000 ms de
 * latencia», es una caída. Mezclarlos haría que un día con 3 caídas parezca un día lento.
 */

import { Op, fn, col, literal } from 'sequelize';

/** Granularidades soportadas. */
export const GRANULARIDADES = ['dia', 'mes', 'anio'];

/**
 * Rollup del día indicado: agrega los chequeos de una fecha en `sitio_velocidad_dia`.
 *
 * Idempotente por el único `(vistaId, fecha)`: re-correrlo actualiza la fila. Eso importa
 * porque corre en cada arranque de la tarea diaria y porque se puede llamar a mano para
 * recuperar un día que se perdió por un reinicio.
 * @param {object} models - Modelos de la app.
 * @param {string} fecha - Día a consolidar (YYYY-MM-DD).
 * @returns {Promise<number>} Cuántas filas de resumen quedaron escritas.
 */
export const consolidarDia = async (models, fecha) => {
    const { SitioChequeo, SitioVelocidadDia } = models;
    if (!SitioChequeo || !SitioVelocidadDia) return 0;

    // Se agrupa en SQL: traer los ~288 chequeos por vista por día a Node para promediarlos
    // sería mover datos sin motivo.
    const filas = await SitioChequeo.findAll({
        attributes: [
            'sitioId', 'vistaId',
            [fn('COUNT', col('id')), 'muestras'],
            // Promedio/min/max SOLO de los que respondieron (ver la nota del encabezado).
            [fn('AVG', literal("CASE WHEN estado <> 'offline' THEN tiempoMs END")), 'promedioMs'],
            [fn('MIN', literal("CASE WHEN estado <> 'offline' THEN tiempoMs END")), 'minMs'],
            [fn('MAX', literal("CASE WHEN estado <> 'offline' THEN tiempoMs END")), 'maxMs'],
            [fn('SUM', literal("CASE WHEN estado = 'online' THEN 1 ELSE 0 END")), 'online'],
        ],
        where: {
            vistaId: { [Op.ne]: null },
            createdAt: { [Op.gte]: `${fecha} 00:00:00`, [Op.lte]: `${fecha} 23:59:59` },
        },
        group: ['sitioId', 'vistaId'],
        raw: true,
    });

    for (const f of filas) {
        const muestras = Number(f.muestras) || 0;
        const online = Number(f.online) || 0;
        const datos = {
            sitioId: f.sitioId,
            vistaId: f.vistaId,
            fecha,
            muestras,
            promedioMs: f.promedioMs == null ? null : Math.round(Number(f.promedioMs)),
            minMs: f.minMs == null ? null : Number(f.minMs),
            maxMs: f.maxMs == null ? null : Number(f.maxMs),
            disponibilidad: muestras ? Math.round((online / muestras) * 10000) / 100 : null,
        };
        const [fila, creada] = await SitioVelocidadDia.findOrCreate({
            where: { vistaId: f.vistaId, fecha },
            defaults: datos,
        });
        if (!creada) await fila.update(datos);
    }
    return filas.length;
};

/**
 * Serie del día en curso, calculada del detalle (todavía no está consolidado).
 * @param {object} models - Modelos de la app.
 * @param {number[]} vistaIds - Vistas.
 * @param {string} hoy - Fecha de hoy (YYYY-MM-DD).
 * @returns {Promise<object[]>} Una fila por vista con la misma forma que el rollup.
 */
const parcialDeHoy = async (models, vistaIds, hoy) => {
    const { SitioChequeo } = models;
    const filas = await SitioChequeo.findAll({
        attributes: [
            'vistaId',
            [fn('COUNT', col('id')), 'muestras'],
            [fn('AVG', literal("CASE WHEN estado <> 'offline' THEN tiempoMs END")), 'promedioMs'],
            [fn('MIN', literal("CASE WHEN estado <> 'offline' THEN tiempoMs END")), 'minMs'],
            [fn('MAX', literal("CASE WHEN estado <> 'offline' THEN tiempoMs END")), 'maxMs'],
            [fn('SUM', literal("CASE WHEN estado = 'online' THEN 1 ELSE 0 END")), 'online'],
        ],
        where: { vistaId: { [Op.in]: vistaIds }, createdAt: { [Op.gte]: `${hoy} 00:00:00` } },
        group: ['vistaId'],
        raw: true,
    });
    return filas.map((f) => {
        const muestras = Number(f.muestras) || 0;
        return {
            vistaId: f.vistaId,
            periodo: hoy,
            muestras,
            promedioMs: f.promedioMs == null ? null : Math.round(Number(f.promedioMs)),
            minMs: f.minMs == null ? null : Number(f.minMs),
            maxMs: f.maxMs == null ? null : Number(f.maxMs),
            disponibilidad: muestras ? Math.round((Number(f.online) / muestras) * 10000) / 100 : null,
            parcial: true,
        };
    });
};

/** Expresión SQL del período según la granularidad. */
const EXPR_PERIODO = {
    dia: "DATE_FORMAT(fecha, '%Y-%m-%d')",
    mes: "DATE_FORMAT(fecha, '%Y-%m')",
    anio: "DATE_FORMAT(fecha, '%Y')",
};

/**
 * Cuántos períodos hacia atrás se devuelven por defecto en cada granularidad.
 * Un mes de días, dos años de meses y todo lo que haya de años: es lo que entra en un gráfico
 * de línea sin volverse ilegible.
 */
const VENTANA = { dia: 30, mes: 24, anio: 10 };

/**
 * Serie de velocidad de un sitio, por vista.
 * @param {object} models - Modelos de la app.
 * @param {number} sitioId - Sitio.
 * @param {object} [opts] - Opciones.
 * @param {string} [opts.granularidad] - dia | mes | anio.
 * @param {number} [opts.vistaId] - Solo una vista (default: todas).
 * @returns {Promise<{granularidad: string, periodos: string[], vistas: object[]}>}
 */
export const velocidadDeSitio = async (models, sitioId, opts = {}) => {
    const { SitioVista, SitioVelocidadDia } = models;
    const granularidad = GRANULARIDADES.includes(opts.granularidad) ? opts.granularidad : 'dia';

    const filas0 = await SitioVista.findAll({
        where: { sitioId, ...(opts.vistaId ? { id: Number(opts.vistaId) } : {}) },
        order: [['orden', 'ASC'], ['ruta', 'ASC']],
    });
    // Sin `raw`: `activo` tiene que salir como booleano, no como el 0/1 de MySQL.
    const vistas = filas0.map(v => v.toJSON());
    if (!vistas.length) return { granularidad, periodos: [], vistas: [] };
    const vistaIds = vistas.map(v => v.id);

    const expr = EXPR_PERIODO[granularidad];
    const filas = await SitioVelocidadDia.findAll({
        attributes: [
            'vistaId',
            [literal(expr), 'periodo'],
            [fn('SUM', col('muestras')), 'muestras'],
            // Promedio PONDERADO por muestras: promediar los promedios diarios le daría el
            // mismo peso a un día con 12 chequeos que a uno con 288.
            [literal('SUM(promedioMs * muestras) / NULLIF(SUM(CASE WHEN promedioMs IS NULL THEN 0 ELSE muestras END), 0)'), 'promedioMs'],
            [fn('MIN', col('minMs')), 'minMs'],
            [fn('MAX', col('maxMs')), 'maxMs'],
            [literal('SUM(disponibilidad * muestras) / NULLIF(SUM(CASE WHEN disponibilidad IS NULL THEN 0 ELSE muestras END), 0)'), 'disponibilidad'],
        ],
        where: { vistaId: { [Op.in]: vistaIds } },
        group: ['vistaId', literal(expr)],
        order: [[literal(expr), 'ASC']],
        raw: true,
    });

    const hoy = new Date().toISOString().slice(0, 10);
    const periodoDeHoy = { dia: hoy, mes: hoy.slice(0, 7), anio: hoy.slice(0, 4) }[granularidad];

    const normalizar = (f) => ({
        vistaId: f.vistaId,
        periodo: String(f.periodo),
        muestras: Number(f.muestras) || 0,
        promedioMs: f.promedioMs == null ? null : Math.round(Number(f.promedioMs)),
        minMs: f.minMs == null ? null : Number(f.minMs),
        maxMs: f.maxMs == null ? null : Number(f.maxMs),
        disponibilidad: f.disponibilidad == null ? null : Math.round(Number(f.disponibilidad) * 100) / 100,
    });
    const datos = filas.map(normalizar);

    // El día de hoy todavía no está consolidado: se agrega del detalle. Si el rollup ya lo
    // escribió (porque se corrió a mano), el parcial lo REEMPLAZA — es más fresco.
    const parciales = await parcialDeHoy(models, vistaIds, hoy);
    for (const p of parciales) {
        if (granularidad === 'dia') {
            const i = datos.findIndex(d => d.vistaId === p.vistaId && d.periodo === hoy);
            if (i >= 0) datos[i] = { ...p, periodo: hoy };
            else datos.push({ ...p, periodo: hoy });
        } else if (!datos.some(d => d.vistaId === p.vistaId && d.periodo === periodoDeHoy)) {
            // Mes o año sin ningún día consolidado todavía (el primer día del mes): se abre el
            // período con lo de hoy en vez de dejar un hueco en la serie.
            datos.push({ ...p, periodo: periodoDeHoy });
        }
    }

    // Ventana: los últimos N períodos con datos, no un rango de fechas fijo. Un sitio que se
    // dio de alta ayer tiene que verse igual de bien que uno con dos años de historia.
    const periodos = [...new Set(datos.map(d => d.periodo))].sort().slice(-VENTANA[granularidad]);
    const dentro = new Set(periodos);

    return {
        granularidad,
        periodos,
        vistas: vistas.map(v => ({
            id: v.id,
            ruta: v.ruta,
            nombre: v.nombre,
            activo: v.activo,
            // Una serie alineada con `periodos`: null donde no hubo datos. El gráfico necesita
            // el hueco explícito para cortar la línea en vez de unir dos meses lejanos.
            serie: periodos.map((p) => {
                const d = datos.find(x => x.vistaId === v.id && x.periodo === p);
                return d ? { promedioMs: d.promedioMs, muestras: d.muestras, disponibilidad: d.disponibilidad, minMs: d.minMs, maxMs: d.maxMs } : null;
            }),
        })),
    };
};
