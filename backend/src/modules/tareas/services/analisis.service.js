/**
 * Service de **Análisis de tareas** — la pantalla de estadísticas del módulo.
 *
 * Todo lo de acá es SOLO LECTURA y sale de las MISMAS condiciones SQL que el resumen y los
 * listados (`sqlCategorias`): si un número de esta pantalla no coincidiera con el listado al
 * que lleva, la pantalla no serviría para decidir nada.
 *
 * Alcance: los espacios VISIBLES del que mira, opcionalmente recortados por el filtro `e`
 * (`alcanceEspacios`). Dos personas con accesos distintos ven números distintos, y está bien:
 * cada una ve el análisis de SU parte del tablero.
 *
 * ⚠️ Fuente de las fechas de cierre: la bitácora `tarea_cambios` (campo `estado`,
 * `valorNuevo = 'completada'`), NO `tareas.updatedAt`. Una tarea completada que después se
 * renombra seguiría teniendo `updatedAt` de hoy y contaría como «realizada hoy». La bitácora
 * es append-only y arrastra también el historial migrado del sistema PHP (migración 0006).
 */

import { Op } from 'sequelize';
import { ESTADOS_TAREA, PRIORIDADES_TAREA } from '../models/Tarea.js';
import {
    alcanceEspacios, catalogoEspacios, sqlCategorias, getDiasPorVencer, equipoDashboard
} from './tarea.service.js';

/** Cubetas de antigüedad de las pendientes (días desde que se creó la tarea). */
const CUBETAS_AGING = [
    { clave: 'd7', label: 'Hasta 7 días', cond: 'diff <= 7' },
    { clave: 'd30', label: '8 a 30 días', cond: 'diff BETWEEN 8 AND 30' },
    { clave: 'd90', label: '31 a 90 días', cond: 'diff BETWEEN 31 AND 90' },
    { clave: 'mas', label: 'Más de 90 días', cond: 'diff > 90' }
];

/** Tope del listado de estancadas (es un «mirá estas», no un listado completo). */
const TOPE_ESTANCADAS = 15;

/**
 * Fecha ISO (YYYY-MM-DD) o null si no parece una fecha.
 * @param {*} v - Valor del query string.
 * @returns {string|null} La fecha normalizada.
 */
const fechaIso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);

/**
 * Rango por defecto: el MES ACTUAL completo (del 1 al último día), que es lo que la pantalla
 * muestra al abrirse. Se calcula en el servidor para que el mes sea el mismo que el de las
 * consultas SQL (`CURDATE()`), y no el del reloj del navegador.
 * @returns {{desde: string, hasta: string}} Rango ISO.
 */
const mesActual = () => {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { desde: iso(new Date(y, m, 1)), hasta: iso(new Date(y, m + 1, 0)) };
};

/**
 * Conteos por estado + total + vencidas, agrupados por una columna.
 *
 * Incluye las COMPLETADAS a propósito (el resumen del módulo solo mira pendientes): acá la
 * pregunta es «cuánto trabajo hay y cuánto se cerró en cada lista», no «qué falta».
 * @param {object} models - Modelos de la app.
 * @param {string} columna - `listaId` o `espacioId`.
 * @param {string} espaciosSql - Condición de alcance.
 * @param {string} vencidasSql - Condición de vencidas.
 * @returns {Promise<object[]>} Filas crudas con la columna y los conteos.
 */
const conteosPor = async (models, columna, espaciosSql, vencidasSql) => {
    const { Tarea } = models;
    const S = (cond) => Tarea.sequelize.literal(`COALESCE(SUM(${cond}), 0)`);
    return Tarea.findAll({
        attributes: [
            columna,
            ...ESTADOS_TAREA.map(e => [S(`\`tareas\`.\`estado\` = '${e}'`), e]),
            [Tarea.sequelize.fn('COUNT', Tarea.sequelize.col('tareas.id')), 'total'],
            [S(vencidasSql), 'vencidas']
        ],
        where: Tarea.sequelize.literal(espaciosSql),
        group: [columna],
        raw: true
    });
};

/**
 * Normaliza una fila de `conteosPor` a números (Sequelize devuelve los SUM como string).
 * @param {object|undefined} fila - Fila cruda.
 * @returns {object} { estados, total, vencidas }.
 */
const normalizarConteos = (fila) => ({
    estados: Object.fromEntries(ESTADOS_TAREA.map(e => [e, Number(fila?.[e]) || 0])),
    total: Number(fila?.total) || 0,
    vencidas: Number(fila?.vencidas) || 0
});

/**
 * Bloque «Tareas por lista»: cada lista con sus tareas por estado, completadas incluidas.
 * Se listan TODAS las listas de los espacios en alcance, también las que tienen 0 tareas
 * (una lista vacía es información: alguien la creó y quedó sin usar).
 * @param {object} models - Modelos de la app.
 * @param {number[]} alcanceIds - Espacios en alcance.
 * @param {string} espaciosSql - Condición de alcance.
 * @param {string} vencidasSql - Condición de vencidas.
 * @returns {Promise<object[]>} Filas ordenadas por espacio y lista.
 */
const bloquePorLista = async (models, alcanceIds, espaciosSql, vencidasSql) => {
    const { Lista, EspacioTrabajo } = models;
    const [filas, listas] = await Promise.all([
        conteosPor(models, 'listaId', espaciosSql, vencidasSql),
        Lista.findAll({
            where: { espacioId: { [Op.in]: alcanceIds } },
            attributes: ['id', 'nombre', 'activa', 'espacioId'],
            include: [{ model: EspacioTrabajo, attributes: ['id', 'nombre'], paranoid: false }],
            order: [[EspacioTrabajo, 'nombre', 'ASC'], ['nombre', 'ASC']]
        })
    ]);
    const porLista = Object.fromEntries(filas.map(f => [Number(f.listaId), f]));
    return listas.map(l => {
        const json = l.toJSON();
        return {
            listaId: json.id,
            lista: json.nombre,
            activa: !!json.activa,
            espacioId: json.espacioId,
            espacio: json.espacios_trabajo?.nombre ?? '',
            ...normalizarConteos(porLista[json.id])
        };
    });
};

/**
 * Bloque «Por espacio»: el mismo cuadro que por lista, un escalón más arriba.
 * @param {object} models - Modelos de la app.
 * @param {Array<{id: number, nombre: string}>} espacios - Espacios en alcance (con nombre).
 * @param {string} espaciosSql - Condición de alcance.
 * @param {string} vencidasSql - Condición de vencidas.
 * @returns {Promise<object[]>} Filas ordenadas por total descendente.
 */
const bloquePorEspacio = async (models, espacios, espaciosSql, vencidasSql) => {
    const filas = await conteosPor(models, 'espacioId', espaciosSql, vencidasSql);
    const por = Object.fromEntries(filas.map(f => [Number(f.espacioId), f]));
    return espacios
        .map(e => ({ espacioId: e.id, espacio: e.nombre, ...normalizarConteos(por[e.id]) }))
        .sort((a, b) => (b.total - a.total) || a.espacio.localeCompare(b.espacio));
};

/**
 * Bloque «Realizadas» del rango elegido: cuánto se cerró entre dos fechas, quién lo cerró y
 * en qué listas cayó ese trabajo.
 *
 * Una tarea puede cerrarse, reabrirse y volver a cerrarse: se cuenta UNA vez (por `tareaId`)
 * y vale el ÚLTIMO cierre dentro del rango, que es el que dejó la tarea como está.
 * «A tiempo» compara el DÍA del cierre contra `fechaVencimiento`; sin fecha de vencimiento no
 * hay contra qué comparar, así que va a su propia cubeta en vez de contarse como cumplida.
 *
 * El detalle tarea por tarea se arma acá pero NO se sirve: la pantalla muestra agregados
 * (por persona y por lista) y devolver cientos de tareas que nadie pinta era peso al pedo.
 * Si algún día hace falta el listado, sale de `tareas` sin tocar las consultas.
 * @param {object} models - Modelos de la app.
 * @param {number[]} alcanceIds - Espacios en alcance.
 * @param {string} desde - Fecha ISO inclusive.
 * @param {string} hasta - Fecha ISO inclusive.
 * @returns {Promise<object>} Bloque del rango.
 */
const bloqueRealizadas = async (models, alcanceIds, desde, hasta) => {
    const { Tarea, TareaCambio, Lista, EspacioTrabajo, User } = models;
    const entre = { [Op.between]: [`${desde} 00:00:00`, `${hasta} 23:59:59`] };

    const [creadas, cambios] = await Promise.all([
        Tarea.count({ where: { espacioId: { [Op.in]: alcanceIds }, createdAt: entre } }),
        TareaCambio.findAll({
            where: { campo: 'estado', valorNuevo: 'completada', createdAt: entre },
            include: [
                {
                    model: Tarea,
                    required: true,
                    where: { espacioId: { [Op.in]: alcanceIds } },
                    attributes: ['id', 'nombre', 'prioridad', 'estado', 'espacioId', 'listaId', 'fechaVencimiento'],
                    include: [
                        { model: Lista, attributes: ['id', 'nombre'], paranoid: false },
                        { model: EspacioTrabajo, attributes: ['id', 'nombre'], paranoid: false },
                        { model: User, as: 'asignado', attributes: ['id', 'name', 'lastName'], required: false, paranoid: false }
                    ]
                },
                { model: User, attributes: ['id', 'name', 'lastName'], required: false, paranoid: false }
            ],
            order: [['createdAt', 'ASC'], ['id', 'ASC']]
        })
    ]);

    // Última transición a completada por tarea (el Map conserva el orden de inserción y las
    // filas vienen ascendentes, así que sobrescribir deja la más nueva).
    const ultima = new Map();
    for (const c of cambios) ultima.set(c.tarea?.id ?? c.tareaId, c);

    const nombreDe = (u) => (u ? `${u.name} ${u.lastName}`.trim() : null);
    const tareas = [...ultima.values()].map(c => {
        const t = c.tarea.toJSON();
        const cerradaEl = c.createdAt;
        const dia = new Date(cerradaEl).toISOString().slice(0, 10);
        const cumplimiento = !t.fechaVencimiento ? 'sin_fecha' : (dia <= t.fechaVencimiento ? 'a_tiempo' : 'tarde');
        return {
            id: t.id,
            nombre: t.nombre,
            prioridad: t.prioridad,
            estado: t.estado,   // puede NO ser 'completada': se reabrió después de cerrarse
            espacioId: t.espacioId,
            espacio: t.espacios_trabajo?.nombre ?? '',
            listaId: t.listaId,
            lista: t.lista?.nombre ?? '',
            asignado: nombreDe(t.asignado),
            cerradaPor: nombreDe(c.user),
            cerradaPorId: c.user?.id ?? null,
            cerradaEl,
            fechaVencimiento: t.fechaVencimiento,
            cumplimiento
        };
    }).sort((a, b) => String(b.cerradaEl).localeCompare(String(a.cerradaEl)));

    // Ranking por quien la MARCÓ completada (dato duro de la bitácora), no por el asignado:
    // el asignado puede haber cambiado después y el cierre ya ocurrió.
    const porUsuario = new Map();
    for (const t of tareas) {
        const clave = t.cerradaPorId ?? 0;
        const fila = porUsuario.get(clave) ?? { userId: clave, nombre: t.cerradaPor ?? 'Sin dato', n: 0, aTiempo: 0 };
        fila.n += 1;
        if (t.cumplimiento === 'a_tiempo') fila.aTiempo += 1;
        porUsuario.set(clave, fila);
    }

    // Cierres por lista del período (la carga completa —con las pendientes— la arma
    // `cargaPorLista`, que cruza esto con los conteos que ya trae el bloque «por lista»).
    const realizadasPorLista = new Map();
    for (const t of tareas) {
        realizadasPorLista.set(t.listaId, (realizadasPorLista.get(t.listaId) ?? 0) + 1);
    }

    const cuenta = (c) => tareas.filter(t => t.cumplimiento === c).length;
    return {
        desde,
        hasta,
        creadas,
        completadas: tareas.length,
        aTiempo: cuenta('a_tiempo'),
        tarde: cuenta('tarde'),
        sinFecha: cuenta('sin_fecha'),
        porUsuario: [...porUsuario.values()].sort((a, b) => (b.n - a.n) || a.nombre.localeCompare(b.nombre)),
        realizadasPorLista: Object.fromEntries(realizadasPorLista)
    };
};

/**
 * Carga por lista del período: lo que sigue PENDIENTE hoy junto a lo que se CERRÓ entre las
 * dos fechas, más el total de las dos cosas (que es por donde ordena la pantalla).
 *
 * No hace ninguna consulta nueva: las pendientes salen de los conteos que el bloque «por
 * lista» ya trajo (`total - completada`, la misma cuenta que muestra esa tabla).
 *
 * Quedan afuera las listas sin nada en las dos columnas: una lista vacía, o una donde todo se
 * completó FUERA del período, no dice nada de la carga de trabajo de hoy ni de este mes.
 *
 * ⚠️ Una tarea cerrada dentro del período y REABIERTA después suma en las dos columnas (está
 * pendiente hoy y se cerró en el período): las dos son ciertas, y el total la cuenta dos
 * veces. Es raro y preferible a esconder una de las dos verdades.
 * @param {object[]} todas - Filas del bloque «por lista» (todas las listas del alcance).
 * @param {Record<string, number>} realizadas - Cierres del período por `listaId`.
 * @returns {object[]} Filas ordenadas por total descendente.
 */
const cargaPorLista = (todas, realizadas) => todas
    .map(l => {
        const cerradas = Number(realizadas[l.listaId]) || 0;
        const pendientes = l.total - l.estados.completada;
        return {
            listaId: l.listaId,
            lista: l.lista,
            espacioId: l.espacioId,
            espacio: l.espacio,
            pendientes,
            realizadas: cerradas,
            total: pendientes + cerradas
        };
    })
    .filter(f => f.total > 0)
    .sort((a, b) => (b.total - a.total) || a.lista.localeCompare(b.lista));

/**
 * Serie mensual «creadas vs. completadas» del año elegido — la única foto en movimiento de la
 * pantalla: dice si el equipo cierra más de lo que entra o al revés.
 * @param {object} models - Modelos de la app.
 * @param {number[]} alcanceIds - Espacios en alcance.
 * @param {number} anio - Año a graficar.
 * @returns {Promise<object>} { anio, creadas: number[12], completadas: number[12] }.
 */
const bloqueSerie = async (models, alcanceIds, anio) => {
    const { Tarea, TareaCambio } = models;
    const desdeAnio = `${anio}-01-01 00:00:00`;
    const hastaAnio = `${anio}-12-31 23:59:59`;

    const [creadasRows, cerradasRows] = await Promise.all([
        Tarea.findAll({
            attributes: [
                [Tarea.sequelize.fn('MONTH', Tarea.sequelize.col('tareas.createdAt')), 'mes'],
                [Tarea.sequelize.fn('COUNT', Tarea.sequelize.col('tareas.id')), 'n']
            ],
            where: { espacioId: { [Op.in]: alcanceIds }, createdAt: { [Op.between]: [desdeAnio, hastaAnio] } },
            group: [Tarea.sequelize.fn('MONTH', Tarea.sequelize.col('tareas.createdAt'))],
            raw: true
        }),
        TareaCambio.findAll({
            attributes: [
                [TareaCambio.sequelize.fn('MONTH', TareaCambio.sequelize.col('tarea_cambios.createdAt')), 'mes'],
                // DISTINCT: una tarea cerrada dos veces en el mismo mes es UN cierre.
                [TareaCambio.sequelize.fn('COUNT', TareaCambio.sequelize.fn('DISTINCT', TareaCambio.sequelize.col('tarea_cambios.tareaId'))), 'n']
            ],
            where: {
                campo: 'estado',
                valorNuevo: 'completada',
                createdAt: { [Op.between]: [desdeAnio, hastaAnio] }
            },
            include: [{
                model: Tarea, attributes: [], required: true,
                where: { espacioId: { [Op.in]: alcanceIds } }
            }],
            group: [TareaCambio.sequelize.fn('MONTH', TareaCambio.sequelize.col('tarea_cambios.createdAt'))],
            raw: true
        })
    ]);

    const aMeses = (filas) => {
        const meses = Array.from({ length: 12 }, () => 0);
        for (const f of filas) meses[Number(f.mes) - 1] = Number(f.n) || 0;
        return meses;
    };
    return { anio, creadas: aMeses(creadasRows), completadas: aMeses(cerradasRows) };
};

/**
 * Bloque «Antigüedad y estancadas»: hace cuánto que están abiertas las pendientes, y cuáles
 * no se tocaron en N días.
 *
 * «Sin movimiento» se mide con `tareas.updatedAt`: CUALQUIER mutación de la tarea (estado,
 * nombre, asignado, fechas, edición rápida) lo toca. Un comentario NO — es charla sobre la
 * tarea, no trabajo sobre la tarea.
 * @param {object} models - Modelos de la app.
 * @param {string} espaciosSql - Condición de alcance.
 * @param {string} pendientesSql - Condición de pendientes.
 * @param {number} diasEstancada - Días sin movimiento para considerarla estancada.
 * @returns {Promise<object>} { cubetas, estancadas, totalEstancadas, diasEstancada }.
 */
const bloqueAntiguedad = async (models, espaciosSql, pendientesSql, diasEstancada) => {
    const { Tarea, Lista, EspacioTrabajo, User } = models;
    const S = (cond) => Tarea.sequelize.literal(`COALESCE(SUM(${cond}), 0)`);
    const diff = 'DATEDIFF(CURDATE(), DATE(`tareas`.`createdAt`))';
    const sinMovimiento = `\`tareas\`.\`updatedAt\` < DATE_SUB(NOW(), INTERVAL ${Number(diasEstancada)} DAY)`;

    const [row, estancadas] = await Promise.all([
        Tarea.findOne({
            attributes: CUBETAS_AGING.map(c => [S(c.cond.replace(/diff/g, diff)), c.clave]),
            where: Tarea.sequelize.literal(`${espaciosSql} AND ${pendientesSql}`),
            raw: true
        }),
        Tarea.findAndCountAll({
            where: Tarea.sequelize.literal(`${espaciosSql} AND ${pendientesSql} AND ${sinMovimiento}`),
            include: [
                { model: Lista, attributes: ['id', 'nombre'], paranoid: false },
                { model: EspacioTrabajo, attributes: ['id', 'nombre'], paranoid: false },
                { model: User, as: 'asignado', attributes: ['id', 'name', 'lastName'], required: false, paranoid: false }
            ],
            attributes: ['id', 'nombre', 'prioridad', 'estado', 'espacioId', 'listaId', 'updatedAt', 'fechaVencimiento'],
            order: [['updatedAt', 'ASC']],
            limit: TOPE_ESTANCADAS,
            // Sin esto el include con limit cuenta filas del JOIN y no tareas.
            distinct: true
        })
    ]);

    const hoy = Date.now();
    return {
        diasEstancada,
        cubetas: CUBETAS_AGING.map(c => ({ clave: c.clave, label: c.label, n: Number(row?.[c.clave]) || 0 })),
        totalEstancadas: estancadas.count,
        estancadas: estancadas.rows.map(t => {
            const json = t.toJSON();
            return {
                id: json.id,
                nombre: json.nombre,
                prioridad: json.prioridad,
                estado: json.estado,
                espacioId: json.espacioId,
                espacio: json.espacios_trabajo?.nombre ?? '',
                listaId: json.listaId,
                lista: json.lista?.nombre ?? '',
                asignado: json.asignado ? `${json.asignado.name} ${json.asignado.lastName}`.trim() : null,
                dias: Math.floor((hoy - new Date(json.updatedAt).getTime()) / 86400000)
            };
        })
    };
};

/**
 * Bloque «Prioridad»: pendientes por prioridad, marcando cuántas están sin responsable.
 * Una urgente sin dueño es el caso que hay que ver de un vistazo.
 * @param {object} models - Modelos de la app.
 * @param {string} espaciosSql - Condición de alcance.
 * @param {string} pendientesSql - Condición de pendientes.
 * @returns {Promise<object[]>} Una fila por prioridad, en el orden del ENUM (baja → urgente).
 */
const bloquePrioridad = async (models, espaciosSql, pendientesSql) => {
    const { Tarea } = models;
    const filas = await Tarea.findAll({
        attributes: [
            'prioridad',
            [Tarea.sequelize.fn('COUNT', Tarea.sequelize.col('tareas.id')), 'n'],
            [Tarea.sequelize.literal('COALESCE(SUM(`tareas`.`asignadoA` IS NULL), 0)'), 'sinAsignar']
        ],
        where: Tarea.sequelize.literal(`${espaciosSql} AND ${pendientesSql}`),
        group: ['prioridad'],
        raw: true
    });
    const por = Object.fromEntries(filas.map(f => [f.prioridad, f]));
    return PRIORIDADES_TAREA.map(p => ({
        prioridad: p,
        n: Number(por[p]?.n) || 0,
        sinAsignar: Number(por[p]?.sinAsignar) || 0
    }));
};

/**
 * Pantalla completa de **Análisis de tareas**.
 *
 * Es UNA sola llamada a propósito: cambiar el rango o el año recalcula todo, pero son
 * agregados sobre columnas indexadas y la pantalla se abre a mano (no autorefresca como el
 * Panel). Partirla en cinco endpoints haría que cinco spinners aparecieran a destiempo.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario que mira.
 * @param {object} q - Query: { desde, hasta, anio, e, estancadas }.
 * @returns {Promise<object>} Todos los bloques + el catálogo de espacios para el filtro.
 */
export const analisisTareas = async (models, user, q = {}) => {
    const { visiblesIds, espaciosFiltro, alcanceIds } = await alcanceEspacios(models, user, q.e);
    const dias = await getDiasPorVencer(models);
    const porDefecto = mesActual();
    let desde = fechaIso(q.desde) ?? porDefecto.desde;
    let hasta = fechaIso(q.hasta) ?? porDefecto.hasta;
    if (desde > hasta) [desde, hasta] = [hasta, desde];   // invertido = lo mismo al revés
    const anio = Number.isInteger(Number(q.anio)) && Number(q.anio) >= 2000 && Number(q.anio) <= 2100
        ? Number(q.anio)
        : new Date().getFullYear();
    const estancadasDias = Math.min(Math.max(Math.trunc(Number(q.estancadas)) || 14, 1), 365);

    const vacio = {
        dias, anio, espacios: [], espaciosFiltro: [],
        equipo: { tarjetas: null, enProgreso: [], porUsuario: [], dias },
        porLista: [], porEspacio: [],
        rango: {
            desde, hasta, creadas: 0, completadas: 0, aTiempo: 0, tarde: 0, sinFecha: 0,
            porUsuario: [], porLista: []
        },
        serie: { anio, creadas: Array(12).fill(0), completadas: Array(12).fill(0) },
        antiguedad: { diasEstancada: estancadasDias, cubetas: [], totalEstancadas: 0, estancadas: [] },
        prioridad: []
    };
    if (!visiblesIds.length) return vacio;

    const cat = sqlCategorias(dias);
    const espaciosSql = `\`tareas\`.\`espacioId\` IN (${alcanceIds.join(',')})`;
    const catalogo = await catalogoEspacios(models, visiblesIds);
    const enAlcance = catalogo.filter(x => alcanceIds.includes(x.id));

    const [equipo, porLista, porEspacio, rango, serie, antiguedad, prioridad] = await Promise.all([
        equipoDashboard(models, user, alcanceIds, dias),
        bloquePorLista(models, alcanceIds, espaciosSql, cat.vencidas),
        bloquePorEspacio(models, enAlcance, espaciosSql, cat.vencidas),
        bloqueRealizadas(models, alcanceIds, desde, hasta),
        bloqueSerie(models, alcanceIds, anio),
        bloqueAntiguedad(models, espaciosSql, cat.pendientes, estancadasDias),
        bloquePrioridad(models, espaciosSql, cat.pendientes)
    ]);

    // La carga por lista del período necesita los dos bloques, así que se arma acá (después
    // del Promise.all) y no dentro de ninguno de ellos.
    const { realizadasPorLista, ...restoRango } = rango;
    return {
        dias, anio, espacios: catalogo, espaciosFiltro, equipo, porLista, porEspacio,
        rango: { ...restoRango, porLista: cargaPorLista(porLista, realizadasPorLista) },
        serie, antiguedad, prioridad
    };
};
