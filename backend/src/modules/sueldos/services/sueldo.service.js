/**
 * Service del módulo `sueldos` — la lógica salarial completa.
 *
 * FUENTE DE VERDAD UNIFICADA (PRD §6.5, corrige la doble fuente del legado §7.1):
 * el vigente se deriva SIEMPRE del historial con `salarioEnMes`; `empleados.sueldo` es
 * un cache que se sincroniza tras cada mutación. Semántica del legado que se conserva:
 *  - `salarioEnMes` compara contra el ÚLTIMO DÍA del mes (un aumento fechado el 25 ya
 *    cuenta como vigente el 1); desempate fecha DESC, id DESC.
 *  - Hacia atrás el sueldo se "extiende" con el PRIMER valor conocido (sueldoNuevo del
 *    registro más viejo), nunca con 0.
 *  - Redondeo a peso entero half-away-from-zero; % con decimales y negativos.
 *  - Aumentos multi-mes: los % NO se encadenan (todos toman el mismo mes base); el
 *    reemplazo por mes borra lo que hubiera — acá el preview AVISA qué se pisa (mejora).
 *  - El `sueldoAnterior` de cada línea se calcula DENTRO de la transacción, en orden
 *    cronológico (ve los INSERT de la misma tanda).
 */

import { Op } from 'sequelize';

/**
 * Error de negocio con status.
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje.
 * @returns {Error} Error enriquecido.
 */
const bizError = (statusCode, message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

/** Redondeo del legado: a peso entero, half away from zero. */
export const redondear = (x) => Math.sign(x) * Math.round(Math.abs(x));

/** Último día de un mes en ISO ('YYYY-MM-DD'). */
const finDeMes = (anio, mes) => {
    const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    return `${anio}-${String(mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
};

/** Hoy en ISO. */
const hoyIso = () => new Date().toISOString().slice(0, 10);

/**
 * Sueldo vigente en un mes, como FUNCIÓN PURA sobre el historial del empleado.
 * @param {object[]} historial - Actualizaciones del empleado (cualquier orden).
 * @param {number} sueldoActual - Cache `empleados.sueldo` (fallback sin historial).
 * @param {number} anio - Año.
 * @param {number} mes - Mes (1-12).
 * @returns {number} Sueldo vigente ese mes.
 */
export const salarioEnMesPuro = (historial, sueldoActual, anio, mes) => {
    const fin = finDeMes(anio, mes);
    // 1) último registro con fecha <= fin de mes (fecha DESC, id DESC).
    const previos = historial
        .filter(h => String(h.fecha) <= fin)
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || b.id - a.id);
    if (previos.length) return Number(previos[0].sueldoNuevo);
    // 2) sin previos: el PRIMER registro histórico "extiende" hacia atrás.
    const primeros = [...historial]
        .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id);
    if (primeros.length) return Number(primeros[0].sueldoNuevo);
    // 3) sin historial: el cache.
    return Number(sueldoActual) || 0;
};

/**
 * Variante con base: lee el historial del empleado (respetando la transacción — los
 * aumentos dependen de ver los INSERT de la misma tanda).
 * @param {object} models - Modelos de la app.
 * @param {object} empleado - Empleado ({ id, sueldo }).
 * @param {number} anio - Año.
 * @param {number} mes - Mes.
 * @param {object|null} [t] - Transacción.
 * @returns {Promise<number>} Sueldo vigente.
 */
export const salarioEnMes = async (models, empleado, anio, mes, t = null) => {
    const historial = await models.SueldoActualizacion.findAll({
        where: { empleadoId: empleado.id },
        raw: true,
        transaction: t
    });
    return salarioEnMesPuro(historial, empleado.sueldo, anio, mes);
};

/**
 * Historiales por empleado en UNA query (para listados sin N+1).
 * @param {object} models - Modelos de la app.
 * @param {number[]} empleadoIds - Ids.
 * @returns {Promise<Record<number, object[]>>} empleadoId → actualizaciones.
 */
const historialesPorEmpleado = async (models, empleadoIds) => {
    if (!empleadoIds.length) return {};
    const filas = await models.SueldoActualizacion.findAll({
        where: { empleadoId: { [Op.in]: empleadoIds } },
        raw: true
    });
    const mapa = {};
    for (const f of filas) (mapa[f.empleadoId] ??= []).push(f);
    return mapa;
};

/**
 * Sincroniza el cache `empleados.sueldo` con el vigente HOY (fin del mes corriente).
 * @param {object} models - Modelos de la app.
 * @param {object} empleado - Instancia de Empleado.
 * @param {object|null} [t] - Transacción.
 * @returns {Promise<number>} El vigente aplicado.
 */
const sincronizarCache = async (models, empleado, t = null) => {
    const ahora = new Date();
    const vig = await salarioEnMes(models, empleado, ahora.getFullYear(), ahora.getMonth() + 1, t);
    await empleado.update({ sueldo: vig }, { transaction: t });
    return vig;
};

/**
 * Listado de sueldos: vigente hoy (por lote), último cambio aplicado y aumentos futuros,
 * más cabecera (activos + masa salarial).
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object>} { rows, activos, masaSalarial }.
 */
export const listSueldos = async (models) => {
    const { Empleado } = models;
    const empleados = await Empleado.findAll({
        order: [['activo', 'DESC'], ['createdAt', 'ASC'], ['id', 'ASC']],
        raw: true
    });
    const historiales = await historialesPorEmpleado(models, empleados.map(e => e.id));
    const hoy = hoyIso();
    const ahora = new Date();

    const rows = empleados.map(e => {
        const hist = historiales[e.id] || [];
        const aplicados = hist.filter(h => String(h.fecha) <= hoy);
        return {
            id: e.id,
            nombre: e.nombre,
            categoria: e.categoria,
            activo: !!e.activo,
            vigente: salarioEnMesPuro(hist, e.sueldo, ahora.getFullYear(), ahora.getMonth() + 1),
            ultCambio: aplicados.length ? aplicados.map(h => String(h.fecha)).sort().at(-1) : null,
            futuros: hist.filter(h => String(h.fecha) > hoy).length
        };
    });

    const activos = rows.filter(r => r.activo);
    return {
        rows,
        activos: activos.length,
        masaSalarial: activos.reduce((acc, r) => acc + r.vigente, 0)
    };
};

/**
 * Edición inline del sueldo (fuente unificada): registra el cambio contra el VIGENTE y
 * sincroniza el cache. Solo empleados activos (el legado dejaba colar inactivos por POST).
 * @param {object} models - Modelos de la app.
 * @param {number} empleadoId - Empleado.
 * @param {number} sueldo - Nuevo monto (entero >= 0).
 * @param {number} userId - Quién.
 * @returns {Promise<{vigente: number, registrado: boolean}>}
 */
export const setSueldo = async (models, empleadoId, sueldo, userId) => {
    const { Empleado, SueldoActualizacion } = models;
    const empleado = await Empleado.findByPk(empleadoId);
    if (!empleado) throw bizError(404, 'Empleado no encontrado');
    if (!empleado.activo) throw bizError(400, 'Solo se pueden actualizar sueldos de empleados activos');

    const nuevo = Math.max(0, redondear(Number(sueldo)));
    return Empleado.sequelize.transaction(async (t) => {
        const ahora = new Date();
        const vigente = await salarioEnMes(models, empleado, ahora.getFullYear(), ahora.getMonth() + 1, t);
        let registrado = false;
        if (Math.abs(vigente - nuevo) >= 0.5) {
            await SueldoActualizacion.create({
                empleadoId, fecha: hoyIso(), sueldoAnterior: vigente, sueldoNuevo: nuevo,
                porcentaje: null, baseMes: null, userId
            }, { transaction: t });
            registrado = true;
        }
        const vig = await sincronizarCache(models, empleado, t);
        return { vigente: vig, registrado };
    });
};

/**
 * Normaliza un porcentaje (acepta coma decimal y negativos).
 * @param {string|number} raw - Valor crudo.
 * @returns {number} El porcentaje.
 * @throws {Error} 400 si no es numérico.
 */
const parsePorcentaje = (raw) => {
    const pct = Number(String(raw ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(pct) || String(raw ?? '').trim() === '') {
        throw bizError(400, 'Ingresá el porcentaje de actualización');
    }
    return pct;
};

/**
 * Empleados ACTIVOS entre los ids (guardas del legado).
 * @param {object} models - Modelos de la app.
 * @param {number[]} ids - Ids seleccionados.
 * @returns {Promise<object[]>} Empleados activos ordenados por nombre.
 */
const activosDe = async (models, ids) => {
    if (!ids?.length) throw bizError(400, 'No seleccionaste ningún empleado');
    const empleados = await models.Empleado.findAll({
        where: { id: { [Op.in]: ids.map(Number) }, activo: true },
        order: [['nombre', 'ASC']]
    });
    if (!empleados.length) throw bizError(400, 'No hay empleados activos entre los seleccionados');
    return empleados;
};

/**
 * Preview de actualización por % (individual o masiva; overrides por fila).
 * Base = sueldo VIGENTE (fuente unificada — el legado usaba el cache crudo).
 * @param {object} models - Modelos de la app.
 * @param {number[]} ids - Empleados.
 * @param {string|number} porcentaje - % global.
 * @param {Record<number, string|number>} [overrides] - % por empleado (pisa el global).
 * @returns {Promise<object[]>} Filas { empleadoId, nombre, base, porcentaje, nuevo }.
 */
export const previewActualizacion = async (models, ids, porcentaje, overrides = {}) => {
    const empleados = await activosDe(models, ids);
    const pctGlobal = parsePorcentaje(porcentaje);
    const historiales = await historialesPorEmpleado(models, empleados.map(e => e.id));
    const ahora = new Date();

    return empleados.map(e => {
        const raw = overrides[e.id];
        const pct = (raw !== undefined && raw !== null && String(raw).trim() !== '') ? parsePorcentaje(raw) : pctGlobal;
        const base = salarioEnMesPuro(historiales[e.id] || [], e.sueldo, ahora.getFullYear(), ahora.getMonth() + 1);
        return { empleadoId: e.id, nombre: e.nombre, base, porcentaje: pct, nuevo: redondear(base * (1 + pct / 100)) };
    });
};

/**
 * Aplica la actualización por % (misma matemática del preview) en UNA transacción.
 * @param {object} models - Modelos de la app.
 * @param {number[]} ids - Empleados.
 * @param {string|number} porcentaje - % global.
 * @param {Record<number, string|number>} overrides - Overrides.
 * @param {number} userId - Quién.
 * @returns {Promise<{actualizados: number}>}
 */
export const aplicarActualizacion = async (models, ids, porcentaje, overrides, userId) => {
    const filas = await previewActualizacion(models, ids, porcentaje, overrides);
    const { Empleado, SueldoActualizacion } = models;

    await Empleado.sequelize.transaction(async (t) => {
        for (const fila of filas) {
            await SueldoActualizacion.create({
                empleadoId: fila.empleadoId,
                fecha: hoyIso(),
                sueldoAnterior: fila.base,
                sueldoNuevo: fila.nuevo,
                porcentaje: fila.porcentaje,
                baseMes: null,
                userId
            }, { transaction: t });
            const empleado = await Empleado.findByPk(fila.empleadoId, { transaction: t });
            await sincronizarCache(models, empleado, t);
        }
    });
    return { actualizados: filas.length };
};

/**
 * Tipo legible de un registro del historial (regla del legado §2.7).
 * @param {object} h - Registro.
 * @returns {string} 'Ajuste ±N%' (+ base) | 'Carga inicial' | 'Edición manual'.
 */
const tipoCambio = (h) => {
    if (h.porcentaje !== null && h.porcentaje !== undefined) {
        const pct = Number(h.porcentaje);
        const base = h.baseMes ? ` (base ${String(h.baseMes).slice(5, 7)}/${String(h.baseMes).slice(0, 4)})` : '';
        return `Ajuste ${pct >= 0 ? '+' : ''}${pct}%${base}`;
    }
    if (Number(h.sueldoAnterior) <= 0.5) return 'Carga inicial';
    return 'Edición manual';
};

/**
 * Historial de un empleado (funciona para inactivos), con tipo y variación %.
 * @param {object} models - Modelos de la app.
 * @param {number} empleadoId - Empleado.
 * @returns {Promise<object|null>} { empleado, vigente, historial } o null.
 */
export const getHistorial = async (models, empleadoId) => {
    const { Empleado, SueldoActualizacion, User } = models;
    const empleado = await Empleado.findByPk(empleadoId);
    if (!empleado) return null;

    const filas = await SueldoActualizacion.findAll({
        where: { empleadoId },
        include: [{ model: User, attributes: ['id', 'name', 'lastName'], required: false, paranoid: false }],
        order: [['fecha', 'DESC'], ['id', 'DESC']]
    });
    const ahora = new Date();
    const vigente = salarioEnMesPuro(filas.map(f => f.toJSON()), empleado.sueldo, ahora.getFullYear(), ahora.getMonth() + 1);

    return {
        empleado: { id: empleado.id, nombre: empleado.nombre, activo: empleado.activo },
        vigente,
        historial: filas.map(h => ({
            id: h.id,
            fecha: h.fecha,
            tipo: tipoCambio(h),
            anterior: Number(h.sueldoAnterior),
            nuevo: Number(h.sueldoNuevo),
            variacion: Number(h.sueldoAnterior) > 0.5
                ? Math.round((Number(h.sueldoNuevo) / Number(h.sueldoAnterior) - 1) * 10000) / 100
                : null,
            usuario: h.user ? `${h.user.name} ${h.user.lastName}`.trim() : null
        }))
    };
};

// ─────────────────────────── Aumentos programados ───────────────────────────

/**
 * Normaliza las líneas de aumento (descarte silencioso del legado: mes/año/valor
 * inválidos se ignoran) y las ordena cronológicamente.
 * @param {object[]} lineas - [{ anio, mes, tipo: 'pct'|'fijo', valor }].
 * @returns {object[]} Líneas válidas ordenadas.
 */
const normalizarLineas = (lineas = []) => (lineas
    .map(l => ({
        anio: Number(l.anio), mes: Number(l.mes), tipo: l.tipo === 'fijo' ? 'fijo' : 'pct',
        valor: Number(String(l.valor ?? '').trim().replace(',', '.'))
    }))
    .filter(l => l.mes >= 1 && l.mes <= 12 && l.anio >= 2000 && l.anio <= 2100 && Number.isFinite(l.valor))
    .sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes)));

/**
 * Valida las entradas de aumentos (mensajes del legado, juntos).
 * @param {object[]} empleados - Activos seleccionados.
 * @param {object[]} lineas - Líneas normalizadas.
 * @param {number} baseAnio - Año base.
 * @param {number} baseMes - Mes base.
 * @throws {Error} 400 con los errores concatenados.
 */
const validarAumentos = (empleados, lineas, baseAnio, baseMes) => {
    const errores = [];
    if (!empleados.length) errores.push('Elegí al menos un empleado');
    if (!lineas.length) errores.push('Cargá al menos un aumento (mes y valor)');
    const hayPct = lineas.some(l => l.tipo === 'pct');
    const baseOk = baseMes >= 1 && baseMes <= 12 && baseAnio >= 2000 && baseAnio <= 2100;
    if (hayPct && !baseOk) errores.push('Elegí un mes base válido para los porcentajes');
    if (errores.length) throw bizError(400, errores.join('. '));
};

/**
 * Preview de aumentos: matriz empleado × línea con el nuevo sueldo + la lista de
 * registros que se PISARÍAN (mejora PRD §6.5: el DELETE por mes del legado era silencioso).
 * Los % NO se encadenan: todos toman el mismo mes base.
 * @param {object} models - Modelos de la app.
 * @param {object} input - { ids, baseAnio, baseMes, lineas }.
 * @returns {Promise<object>} { filas, lineas, pisados }.
 */
export const previewAumentos = async (models, input) => {
    const empleados = await activosDe(models, input.ids);
    const lineas = normalizarLineas(input.lineas);
    const baseAnio = Number(input.baseAnio), baseMes = Number(input.baseMes);
    validarAumentos(empleados, lineas, baseAnio, baseMes);

    const historiales = await historialesPorEmpleado(models, empleados.map(e => e.id));

    const filas = empleados.map(e => {
        const hist = historiales[e.id] || [];
        const base = salarioEnMesPuro(hist, e.sueldo, baseAnio, baseMes);
        return {
            empleadoId: e.id,
            nombre: e.nombre,
            base,
            valores: lineas.map(l => ({
                anio: l.anio, mes: l.mes, tipo: l.tipo, valor: l.valor,
                nuevo: l.tipo === 'pct' ? redondear(base * (1 + l.valor / 100)) : redondear(l.valor)
            }))
        };
    });

    // Qué se pisa: registros existentes de esos empleados en los meses calendario de las líneas.
    const pisados = [];
    for (const e of empleados) {
        for (const l of lineas) {
            const prefijo = `${l.anio}-${String(l.mes).padStart(2, '0')}`;
            for (const h of (historiales[e.id] || []).filter(h => String(h.fecha).startsWith(prefijo))) {
                pisados.push({
                    empleadoId: e.id, nombre: e.nombre, fecha: h.fecha,
                    sueldoNuevo: Number(h.sueldoNuevo), tipo: tipoCambio(h)
                });
            }
        }
    }

    return { filas, lineas, pisados };
};

/**
 * Aplica los aumentos en UNA transacción SECUENCIAL (sin paralelizar: el sueldoAnterior
 * de cada línea depende de los INSERT previos de la misma tanda — regla dura del legado).
 * Por (empleado, línea): DELETE de TODO el mes calendario → anterior = vigente del mes
 * previo (dentro de la trx) → INSERT. Al final, cache = vigente hoy.
 * @param {object} models - Modelos de la app.
 * @param {object} input - { ids, baseAnio, baseMes, lineas }.
 * @param {number} userId - Quién.
 * @returns {Promise<{empleados: number, meses: number}>}
 */
export const aplicarAumentos = async (models, input, userId) => {
    const { Empleado, SueldoActualizacion } = models;
    const empleados = await activosDe(models, input.ids);
    const lineas = normalizarLineas(input.lineas);
    const baseAnio = Number(input.baseAnio), baseMes = Number(input.baseMes);
    validarAumentos(empleados, lineas, baseAnio, baseMes);

    await Empleado.sequelize.transaction(async (t) => {
        for (const empleado of empleados) {
            // Base ÚNICA por empleado (los % no se encadenan), leída antes de tocar nada.
            const base = await salarioEnMes(models, empleado, baseAnio, baseMes, t);

            for (const l of lineas) {
                // Reemplazo por mes calendario (el preview ya avisó qué se pisa).
                await SueldoActualizacion.destroy({
                    where: {
                        empleadoId: empleado.id,
                        fecha: {
                            [Op.gte]: `${l.anio}-${String(l.mes).padStart(2, '0')}-01`,
                            [Op.lte]: finDeMes(l.anio, l.mes)
                        }
                    },
                    transaction: t
                });

                // Vigente del mes ANTERIOR a la línea, viendo los INSERT de esta tanda.
                const mesPrev = l.mes === 1 ? { anio: l.anio - 1, mes: 12 } : { anio: l.anio, mes: l.mes - 1 };
                const anterior = await salarioEnMes(models, empleado, mesPrev.anio, mesPrev.mes, t);

                await SueldoActualizacion.create({
                    empleadoId: empleado.id,
                    fecha: `${l.anio}-${String(l.mes).padStart(2, '0')}-01`,
                    sueldoAnterior: anterior,
                    sueldoNuevo: l.tipo === 'pct' ? redondear(base * (1 + l.valor / 100)) : redondear(l.valor),
                    porcentaje: l.tipo === 'pct' ? l.valor : null,
                    baseMes: l.tipo === 'pct' ? `${baseAnio}-${String(baseMes).padStart(2, '0')}-01` : null,
                    userId
                }, { transaction: t });
            }
            await sincronizarCache(models, empleado, t);
        }
    });

    return { empleados: empleados.length, meses: lineas.length };
};

// ─────────────────────────── Planificación ───────────────────────────

/**
 * Datos de la planificación de un período (default: MES ANTERIOR — los sueldos de un
 * mes se abonan al mes siguiente).
 * @param {object} models - Modelos de la app.
 * @param {number} [anio] - Año pedido.
 * @param {number} [mes] - Mes pedido.
 * @returns {Promise<object>} { anio, mes, anios, empleados, cuentas, celdas, disponibles }.
 */
export const getPlanificacion = async (models, anio, mes) => {
    const { Empleado, CuentaPago, SueldoPago, CuentaDisponible } = models;

    // Período: pedido (clamp) o mes anterior por defecto.
    let a = Number(anio), m = Number(mes);
    if (!(m >= 1 && m <= 12) || !(a >= 2000 && a <= 2100)) {
        const ahora = new Date();
        m = ahora.getMonth(); // 0-based → mes anterior 1-based
        a = ahora.getFullYear();
        if (m === 0) { m = 12; a -= 1; }
    }

    const [empleados, cuentas, pagos, disponibles, aniosPagos, aniosDisp] = await Promise.all([
        Empleado.findAll({ where: { activo: true }, order: [['createdAt', 'ASC'], ['id', 'ASC']], raw: true }),
        CuentaPago.findAll({ where: { activo: true }, order: [['orden', 'ASC'], ['nombre', 'ASC']], raw: true }),
        SueldoPago.findAll({ where: { anio: a, mes: m }, raw: true }),
        CuentaDisponible.findAll({ where: { anio: a, mes: m }, raw: true }),
        SueldoPago.findAll({ attributes: [[SueldoPago.sequelize.fn('DISTINCT', SueldoPago.sequelize.col('anio')), 'anio']], raw: true }),
        CuentaDisponible.findAll({ attributes: [[CuentaDisponible.sequelize.fn('DISTINCT', CuentaDisponible.sequelize.col('anio')), 'anio']], raw: true })
    ]);

    const historiales = await historialesPorEmpleado(models, empleados.map(e => e.id));
    const anios = [...new Set([
        ...aniosPagos.map(r => Number(r.anio)), ...aniosDisp.map(r => Number(r.anio)),
        a, new Date().getFullYear()
    ])].sort();

    return {
        anio: a,
        mes: m,
        anios,
        empleados: empleados.map(e => ({
            id: e.id,
            nombre: e.nombre,
            sueldoDelMes: salarioEnMesPuro(historiales[e.id] || [], e.sueldo, a, m)
        })),
        cuentas: cuentas.map(c => ({ id: c.id, nombre: c.nombre })),
        celdas: pagos.map(p => ({
            empleadoId: p.empleadoId, cuentaId: p.cuentaId,
            monto: Number(p.monto), pagado: !!p.pagado, fechaPago: p.fechaPago
        })),
        disponibles: disponibles.map(d => ({ cuentaId: d.cuentaId, monto: Number(d.monto) }))
    };
};

/**
 * Guarda la planificación de un período: reemplazo completo de la matriz (activos ×
 * cuentas activas). `fechaPago` se conserva mientras siga pagado (regla del legado);
 * monto 0 borra la celda.
 * @param {object} models - Modelos de la app.
 * @param {object} input - { anio, mes, celdas: [{empleadoId, cuentaId, monto, pagado}], disponibles: [{cuentaId, monto}] }.
 * @returns {Promise<void>}
 */
export const savePlanificacion = async (models, input) => {
    const { Empleado, CuentaPago, SueldoPago, CuentaDisponible } = models;
    const anio = Number(input.anio), mes = Number(input.mes);

    const [activos, cuentasActivas] = await Promise.all([
        Empleado.findAll({ where: { activo: true }, attributes: ['id'], raw: true }),
        CuentaPago.findAll({ where: { activo: true }, attributes: ['id'], raw: true })
    ]);
    const empSet = new Set(activos.map(e => e.id));
    const ctaSet = new Set(cuentasActivas.map(c => c.id));

    await SueldoPago.sequelize.transaction(async (t) => {
        // Snapshot previo: conserva fechaPago de lo que siga pagado.
        const previas = await SueldoPago.findAll({ where: { anio, mes }, raw: true, transaction: t });
        const fechaPrevia = Object.fromEntries(previas.map(p => [`${p.empleadoId}:${p.cuentaId}`, p.fechaPago]));

        for (const celda of (input.celdas || [])) {
            const empleadoId = Number(celda.empleadoId), cuentaId = Number(celda.cuentaId);
            // Solo empleados activos y cuentas activas (regla del legado).
            if (!empSet.has(empleadoId) || !ctaSet.has(cuentaId)) continue;
            const monto = Math.max(0, redondear(Number(celda.monto) || 0));
            const pagado = !!celda.pagado;

            if (monto > 0) {
                const fechaPago = pagado ? (fechaPrevia[`${empleadoId}:${cuentaId}`] || hoyIso()) : null;
                const existente = await SueldoPago.findOne({ where: { empleadoId, cuentaId, anio, mes }, transaction: t });
                if (existente) await existente.update({ monto, pagado, fechaPago }, { transaction: t });
                else await SueldoPago.create({ empleadoId, cuentaId, anio, mes, monto, pagado, fechaPago }, { transaction: t });
            } else {
                // Monto 0 → se borra la celda (y su fechaPago, a propósito).
                await SueldoPago.destroy({ where: { empleadoId, cuentaId, anio, mes }, transaction: t });
            }
        }

        for (const disp of (input.disponibles || [])) {
            const cuentaId = Number(disp.cuentaId);
            if (!ctaSet.has(cuentaId)) continue;
            const monto = Math.max(0, redondear(Number(disp.monto) || 0));
            const existente = await CuentaDisponible.findOne({ where: { cuentaId, anio, mes }, transaction: t });
            if (existente) await existente.update({ monto }, { transaction: t });
            else await CuentaDisponible.create({ cuentaId, anio, mes, monto }, { transaction: t });
        }
    });
};

// ─────────────────────────── Cuentas de pago ───────────────────────────

/**
 * Unicidad de nombre de cuenta vs no eliminadas (+ reactivación) — mejora sobre el legado.
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre.
 * @param {number|null} excludeId - Id a excluir.
 * @returns {Promise<void>}
 */
const checkCuentaUnica = async (models, nombre, excludeId = null) => {
    const { CuentaPago } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};
    const viva = await CuentaPago.findOne({ where: { nombre, ...idClause } });
    if (viva) throw bizError(400, 'Ya existe una cuenta con ese nombre');
    const eliminada = await CuentaPago.findOne({ where: { nombre, ...idClause }, paranoid: false });
    if (eliminada && eliminada.deletedAt) {
        const err = bizError(409, `Ya existió una cuenta llamada «${nombre}» (eliminada). Podés reactivarla.`);
        err.errorCode = 'EXISTE_ELIMINADO';
        err.deletedId = eliminada.id;
        throw err;
    }
};

/**
 * Lista cuentas con contador de usos (pagos) en una query agregada.
 * @param {object} models - Modelos de la app.
 * @returns {Promise<object[]>} Cuentas con pagosCount.
 */
export const listCuentas = async (models) => {
    const { CuentaPago, SueldoPago } = models;
    const cuentas = await CuentaPago.findAll({ order: [['orden', 'ASC'], ['nombre', 'ASC']] });
    if (!cuentas.length) return [];
    const usos = await SueldoPago.findAll({
        attributes: ['cuentaId', [SueldoPago.sequelize.fn('COUNT', SueldoPago.sequelize.col('id')), 'n']],
        where: { cuentaId: { [Op.in]: cuentas.map(c => c.id) } },
        group: ['cuentaId'],
        raw: true
    });
    const porCuenta = Object.fromEntries(usos.map(u => [u.cuentaId, Number(u.n)]));
    return cuentas.map(c => ({ ...c.toJSON(), pagosCount: porCuenta[c.id] || 0 }));
};

/**
 * Crea una cuenta.
 * @param {object} models - Modelos de la app.
 * @param {object} data - { nombre, orden? }.
 * @returns {Promise<object>} La cuenta.
 */
export const createCuenta = async (models, data) => {
    await checkCuentaUnica(models, data.nombre);
    return models.CuentaPago.create({ nombre: data.nombre, orden: data.orden ?? 0 });
};

/**
 * Edita una cuenta.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Cuenta.
 * @param {object} data - Campos.
 * @returns {Promise<object|null>} La cuenta o null.
 */
export const updateCuenta = async (models, id, data) => {
    const cuenta = await models.CuentaPago.findByPk(id);
    if (!cuenta) return null;
    if (data.nombre && data.nombre !== cuenta.nombre) await checkCuentaUnica(models, data.nombre, id);
    await cuenta.update({ nombre: data.nombre, orden: data.orden ?? cuenta.orden });
    return cuenta;
};

/**
 * Alterna activo.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Cuenta.
 * @returns {Promise<object|null>} La cuenta o null.
 */
export const toggleCuenta = async (models, id) => {
    const cuenta = await models.CuentaPago.findByPk(id);
    if (!cuenta) return null;
    await cuenta.update({ activo: !cuenta.activo });
    return cuenta;
};

/**
 * Reactiva una cuenta eliminada.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Cuenta.
 * @returns {Promise<object|null>} La cuenta o null.
 */
export const restoreCuenta = async (models, id) => {
    const { CuentaPago } = models;
    const cuenta = await CuentaPago.findByPk(id, { paranoid: false });
    if (!cuenta || !cuenta.deletedAt) return null;
    const viva = await CuentaPago.findOne({ where: { nombre: cuenta.nombre } });
    if (viva) throw bizError(400, 'Ya existe una cuenta activa con ese nombre; renombrala primero');
    await cuenta.restore();
    return cuenta;
};

/**
 * Elimina (soft) una cuenta. MEJORA: con pagos registrados no se elimina (el contador
 * del legado era solo informativo).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Cuenta.
 * @returns {Promise<boolean>} true si se eliminó.
 * @throws {Error} 409 si tiene pagos.
 */
export const deleteCuenta = async (models, id) => {
    const { CuentaPago, SueldoPago } = models;
    const cuenta = await CuentaPago.findByPk(id);
    if (!cuenta) return false;
    const n = await SueldoPago.count({ where: { cuentaId: id } });
    if (n > 0) throw bizError(409, `No se puede eliminar: la cuenta tiene ${n} pago(s) registrado(s). Desactivala en su lugar.`);
    await cuenta.destroy();
    return true;
};
