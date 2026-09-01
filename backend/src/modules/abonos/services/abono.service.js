/**
 * Service del módulo `abonos` — TODA la lógica de negocio y el acceso a datos.
 *
 * Reglas preservadas del sistema legado (../analisis_app_php/05 §1) con las correcciones
 * del PRD: idempotencia en actualizar/facturar (operationId), anulación de facturaciones
 * auditada, estado de actualización calculado en SQL (paginable), y validación de FKs.
 *
 * Conceptos:
 *  - Actualizar ARS: % sobre el precio, redondeado al múltiplo configurado (REDONDEO_ABONOS).
 *  - Actualizar USD: el precio EN DÓLARES se revisa (normalmente no cambia); se registra la
 *    cotización y se reinicia el reloj de actualización.
 *  - Toda actualización fija `fechaUltimaActualizacion` al DÍA 1 del mes corriente.
 *  - Facturar congela precio + cotización + montoPesos; una por (abono, año, mes) vigente.
 *  - Estados: vencido (días <= 0) · próximo (1..30) · al día (> 30) · sin datos (null).
 *    El día que TOCA actualizar ya cuenta como vencido: si hay que hacerlo hoy, no es algo
 *    «próximo», es algo pendiente. (El PHP legado ponía el corte en `< 0` y mandaba el abono
 *    del día a la cubeta de próximos, donde pasaba desapercibido justo el día que importaba.)
 */

import { Op } from 'sequelize';
import { getAppConfigNumber } from '../../../kernel/index.js';
import { ordenSeguro } from '../../../kernel/index.js';

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
 * Redondea un monto al múltiplo configurado (half away from zero, como el legado).
 * @param {number} monto - Monto a redondear.
 * @param {number} redondeo - Múltiplo (>= 1).
 * @returns {number} Monto redondeado.
 */
export const redondear = (monto, redondeo) => {
    const paso = redondeo >= 1 ? redondeo : 1;
    return Math.sign(monto) * Math.round(Math.abs(monto) / paso) * paso;
};

/** Fragmento SQL de la fecha de próxima actualización (base + periodoMeses meses). */
const SQL_PROXIMA = '(DATE_ADD(COALESCE(`abonos`.`fechaUltimaActualizacion`, `abonos`.`fechaInicio`), INTERVAL `abonos`.`periodoMeses` MONTH))';
/**
 * Días hasta la próxima actualización: negativo = atrasada, **0 = hay que hacerla hoy**.
 * Se exporta porque el panel y los avisos diarios miran lo mismo: tenerlo escrito en tres
 * lados fue justamente lo que permitió que el corte de «vencido» quedara distinto en cada uno.
 */
export const SQL_DIAS_ACTUALIZACION = `DATEDIFF(${SQL_PROXIMA}, CURDATE())`;
const SQL_DIAS = SQL_DIAS_ACTUALIZACION;

/** Ventana de «próximo a actualizar», en días (regla del legado). */
export const VENTANA_ACTUALIZACION = 30;

/**
 * Estado de actualización de un abono a partir de sus días — FUENTE ÚNICA de la regla.
 *
 * El corte de vencido es `<= 0`, no `< 0`: el día en que toca actualizar el abono ya está
 * pendiente, no «por vencer». Es lo que se ve todos los días 1 del mes.
 * @param {number|null|undefined} dias - Días hasta la actualización (de `SQL_DIAS_ACTUALIZACION`).
 * @returns {'vencido'|'proximo'|'al_dia'|null} El estado, o null si no hay datos para calcularlo.
 */
export const estadoActualizacion = (dias) => {
    if (dias === null || dias === undefined) return null;
    if (dias <= 0) return 'vencido';
    return dias <= VENTANA_ACTUALIZACION ? 'proximo' : 'al_dia';
};

/**
 * Cotización y redondeo vigentes (configuración de negocio).
 * @param {object} models - Modelos de la app.
 * @returns {Promise<{cotizacion: number, redondeo: number}>}
 */
export const getConfigAbonos = async (models) => ({
    cotizacion: await getAppConfigNumber(models, 'COTIZACION_DOLAR'),
    redondeo: await getAppConfigNumber(models, 'REDONDEO_ABONOS'),
});

/**
 * Equivalente en pesos del precio de un abono: USD → redondeado al múltiplo; ARS → tal cual.
 * @param {{moneda: string, precio: number|string}} abono - Abono (o snapshot).
 * @param {number} cotizacion - Cotización vigente.
 * @param {number} redondeo - Múltiplo de redondeo.
 * @returns {number} Precio en pesos.
 */
export const precioEnPesos = (abono, cotizacion, redondeo) => {
    const precio = Number(abono.precio);
    return abono.moneda === 'USD' ? redondear(precio * cotizacion, redondeo) : precio;
};

/** Includes estándar (cliente/servicio/forma) para las respuestas. */
const abonoIncludes = (models) => [
    { model: models.Cliente, attributes: ['id', 'nombre'] },
    { model: models.Servicio, attributes: ['id', 'nombre', 'areaId'] },
    ...(models.FormaFacturacion ? [{ model: models.FormaFacturacion, as: 'formaFacturacion', attributes: ['id', 'nombre'] }] : []),
];

/**
 * Lista abonos con filtros (cliente, servicios, forma, moneda, período, texto, activo,
 * estado de actualización). `diasParaActualizar` se calcula en SQL para que el filtro por
 * estado sea correcto (el legado filtraba en memoria).
 *
 * **NO pagina, a propósito.** La facturación (y la actualización de precios) son masivas:
 * se seleccionan abonos y se opera sobre el conjunto. Con páginas, «seleccionar todos»
 * marcaba solo la página visible y facturar el mes entero obligaba a repetir la operación
 * página por página. El universo es acotado —los abonos vigentes de la empresa, decenas— y
 * ya viene recortado por los filtros; devolverlos todos cuesta menos que la alternativa.
 * `page` y `limit` se ignoran: se responden igual en `meta` para no romper el envelope.
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - Filtros (page/limit se ignoran).
 * @returns {Promise<{rows: object[], count: number, page: number, limit: number}>}
 */

/**
 * Columnas ordenables del listado de abonos (whitelist para `ordenSeguro`).
 * El precio se ordena por su valor CRUDO: mezclar ARS y USD en un mismo orden numérico
 * sería mentira, pero el usuario ordena para agrupar por moneda-y-magnitud, no para comparar.
 */
const ordenAbonos = (models) => ({
    // Ordenar por una columna de un include exige el MODELO, no el nombre de la asociación:
    // con un string Sequelize lo toma como parte del nombre de la columna y arma `a.Cliente`nombre`.
    cliente: [[models.Cliente, 'nombre', 'ASC']],
    servicio: [[models.Servicio, 'nombre', 'ASC']],
    precio: [['moneda', 'ASC'], ['precio', 'ASC']],
    proximaActualizacion: [['diasParaActualizar', 'ASC']],
    activo: [['activo', 'ASC']],
    fechaInicio: [['fechaInicio', 'ASC']],
});

export const listAbonos = async (models, query = {}) => {
    const { Abono } = models;
    const { where, literalWhere } = buildAbonoFilters(models, query);

    const { rows, count } = await Abono.findAndCountAll({
        where: literalWhere ? { [Op.and]: [where, literalWhere] } : where,
        include: abonoIncludes(models),
        attributes: { include: [[Abono.sequelize.literal(SQL_DIAS), 'diasParaActualizar'], [Abono.sequelize.literal(SQL_PROXIMA), 'proximaActualizacion']] },
        // Clientes históricos primero (por su abono más viejo lo resolvía el legado; acá
        // alcanza con cliente + inicio: mismo efecto práctico, sin subquery frágil).
        order: ordenSeguro(query, ordenAbonos(models), [[models.Cliente, 'nombre', 'ASC'], ['fechaInicio', 'ASC']]),
        distinct: true,
    });

    // Una sola página con todo: `Paginate` divide por el límite, así que nunca puede ser 0.
    return { rows: rows.map(r => r.toJSON()), count, page: 1, limit: Math.max(count, 1) };
};

/**
 * Arma el WHERE de abonos a partir de la query (compartido por listado y resumen).
 * @param {object} models - Modelos de la app.
 * @param {object} query - Filtros crudos.
 * @returns {{where: object, literalWhere: object|null}}
 */
const buildAbonoFilters = (models, query) => {
    const { Abono } = models;
    const where = {};
    if (query.clienteId) where.clienteId = Number(query.clienteId);
    if (query.servicioId) {
        const ids = String(query.servicioId).split(',').map(Number).filter(Boolean);
        if (ids.length) where.servicioId = { [Op.in]: ids };
    }
    if (query.formaFacturacionId) where.formaFacturacionId = Number(query.formaFacturacionId);
    if (query.moneda === 'ARS' || query.moneda === 'USD') where.moneda = query.moneda;
    if (query.periodoMeses) where.periodoMeses = Number(query.periodoMeses);
    if (query.activo !== undefined && query.activo !== '') where.activo = query.activo === 'true' || query.activo === true;
    if (query.search) {
        // Busca en la descripción del abono O en el nombre del cliente. Va por subconsulta y
        // no por `$cliente.nombre$` porque este WHERE lo comparten el listado (que incluye a
        // Cliente) y el resumen (que consulta la tabla sola, sin include).
        const like = Abono.sequelize.escape(`%${query.search}%`);
        where[Op.or] = [
            { descripcion: { [Op.like]: `%${query.search}%` } },
            Abono.sequelize.literal(`\`abonos\`.\`clienteId\` IN (SELECT \`id\` FROM \`clientes\` WHERE \`nombre\` LIKE ${like})`),
        ];
    }

    // Estado de actualización, resuelto en SQL (paginable).
    let literalWhere = null;
    // Los cortes son los mismos que los de `estadoActualizacion`, pero en SQL para poder paginar.
    if (query.estado === 'vencido') literalWhere = Abono.sequelize.literal(`${SQL_DIAS} <= 0`);
    else if (query.estado === 'proximo') literalWhere = Abono.sequelize.literal(`${SQL_DIAS} BETWEEN 1 AND ${VENTANA_ACTUALIZACION}`);
    else if (query.estado === 'aldia') literalWhere = Abono.sequelize.literal(`${SQL_DIAS} > ${VENTANA_ACTUALIZACION}`);
    return { where, literalWhere };
};

/**
 * Resumen del listado (tiles): activos, total mensual en pesos, próximos y vencidos.
 * Aplica los mismos filtros del listado, siempre sobre abonos ACTIVOS.
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - Filtros crudos.
 * @returns {Promise<{activos: number, totalPesos: number, proximos: number, vencidos: number}>}
 */
export const resumenAbonos = async (models, query = {}) => {
    const { Abono } = models;
    const { cotizacion, redondeo } = await getConfigAbonos(models);
    const { where, literalWhere } = buildAbonoFilters(models, { ...query, activo: 'true' });

    const rows = await Abono.findAll({
        where: literalWhere ? { [Op.and]: [where, literalWhere] } : where,
        attributes: ['id', 'moneda', 'precio', [Abono.sequelize.literal(SQL_DIAS), 'diasParaActualizar']],
        raw: true,
    });

    let totalPesos = 0, proximos = 0, vencidos = 0;
    for (const abono of rows) {
        totalPesos += precioEnPesos(abono, cotizacion, redondeo);
        const estado = estadoActualizacion(abono.diasParaActualizar);
        if (estado === 'vencido') vencidos++;
        else if (estado === 'proximo') proximos++;
    }
    return { activos: rows.length, totalPesos, proximos, vencidos, cotizacion };
};

/**
 * Un abono por id (con cliente/servicio/forma y días calculados).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del abono.
 * @returns {Promise<object|null>} El abono o null.
 */
export const getAbono = async (models, id) => {
    const { Abono } = models;
    const abono = await Abono.findByPk(id, {
        include: abonoIncludes(models),
        attributes: { include: [[Abono.sequelize.literal(SQL_DIAS), 'diasParaActualizar'], [Abono.sequelize.literal(SQL_PROXIMA), 'proximaActualizacion']] },
    });
    return abono ? abono.toJSON() : null;
};

/**
 * Valida las FKs de un abono: cliente y servicio obligatorios y existentes; forma opcional.
 * (El legado no validaba y reventaba con un 500 de FK — bug del análisis.)
 * @param {object} models - Modelos de la app.
 * @param {object} data - { clienteId, servicioId, formaFacturacionId? }.
 * @returns {Promise<void>}
 * @throws {Error} 400 con el campo inválido.
 */
const checkRefs = async (models, data) => {
    if (data.clienteId !== undefined) {
        const cliente = await models.Cliente.findByPk(data.clienteId);
        if (!cliente) throw bizError(400, 'El cliente seleccionado no existe');
    }
    if (data.servicioId !== undefined) {
        const servicio = await models.Servicio.findByPk(data.servicioId);
        if (!servicio) throw bizError(400, 'El servicio seleccionado no existe');
    }
    if (data.formaFacturacionId) {
        const forma = await models.FormaFacturacion.findByPk(data.formaFacturacionId);
        if (!forma) throw bizError(400, 'La forma de facturación seleccionada no existe');
    }
};

/**
 * Crea un abono (nace inactivo salvo indicación explícita).
 * @param {object} models - Modelos de la app.
 * @param {object} data - Datos validados.
 * @returns {Promise<object>} El abono creado (con includes).
 */
export const createAbono = async (models, data) => {
    await checkRefs(models, data);
    const created = await models.Abono.create({
        ...data,
        formaFacturacionId: data.formaFacturacionId || null,
    });
    return getAbono(models, created.id);
};

/**
 * Actualiza un abono (datos, no precio: para el precio están los flujos de actualización).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id a editar.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} El abono actualizado o null.
 */
export const updateAbono = async (models, id, data) => {
    const abono = await models.Abono.findByPk(id);
    if (!abono) return null;
    await checkRefs(models, data);
    await abono.update({ ...data, ...(data.formaFacturacionId !== undefined && { formaFacturacionId: data.formaFacturacionId || null }) });
    return getAbono(models, id);
};

/**
 * Alterna el estado activo. Un abono inactivo no se factura ni se actualiza.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del abono.
 * @returns {Promise<object|null>} El abono actualizado o null.
 */
export const toggleAbono = async (models, id) => {
    const abono = await models.Abono.findByPk(id);
    if (!abono) return null;
    await abono.update({ activo: !abono.activo });
    return getAbono(models, id);
};

/**
 * Elimina (soft) un abono. Sus facturaciones son snapshots históricos y se conservan.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del abono.
 * @returns {Promise<boolean>} true si se eliminó.
 */
export const deleteAbono = async (models, id) => {
    const abono = await models.Abono.findByPk(id);
    if (!abono) return false;
    await abono.destroy();
    return true;
};

/**
 * Historial de actualizaciones de un abono (con el usuario que las aplicó).
 * @param {object} models - Modelos de la app.
 * @param {number} abonoId - Id del abono.
 * @returns {Promise<object[]>} Historial (más nuevas primero).
 */
export const getActualizaciones = async (models, abonoId) => {
    const { AbonoActualizacion, User } = models;
    return AbonoActualizacion.findAll({
        where: { abonoId },
        include: User ? [{ model: User, attributes: ['id', 'name', 'lastName'] }] : [],
        order: [['fecha', 'DESC'], ['id', 'DESC']],
    });
};

// ─── Actualización de precios ────────────────────────────────────────────────

/**
 * Calcula la actualización de UN abono (pura, sin escritura). ARS por %, USD por cotización.
 * @param {object} abono - Abono (raw o JSON).
 * @param {object} input - { porcentaje?, cotizacion?, precioUsd? }.
 * @param {{cotizacion: number, redondeo: number}} config - Config vigente.
 * @returns {object} { abonoId, moneda, precioAnterior, precioNuevo, tipo, porcentaje, cotizacion, precioPesos }.
 * @throws {Error} 400 si falta el dato de la moneda correspondiente.
 */
export const calcularActualizacion = (abono, input, config) => {
    const precioActual = Number(abono.precio);

    if (abono.moneda === 'ARS') {
        const pct = Number(String(input.porcentaje ?? '').replace(',', '.'));
        if (!Number.isFinite(pct)) throw bizError(400, 'Ingresá el porcentaje de actualización para los abonos en pesos');
        return {
            abonoId: abono.id,
            moneda: 'ARS',
            precioAnterior: precioActual,
            precioNuevo: redondear(precioActual * (1 + pct / 100), config.redondeo),
            tipo: 'porcentaje',
            porcentaje: pct,
            cotizacion: null,
            precioPesos: null,
        };
    }

    // USD: se revisa el precio en dólares (default: se mantiene) con una cotización > 0.
    const cotiz = Number(String(input.cotizacion ?? config.cotizacion).replace(',', '.'));
    if (!Number.isFinite(cotiz) || cotiz <= 0) throw bizError(400, 'Ingresá una cotización válida (mayor a 0)');
    const precioUsd = input.precioUsd !== undefined && input.precioUsd !== null && input.precioUsd !== ''
        ? Number(String(input.precioUsd).replace(',', '.'))
        : precioActual;
    if (!Number.isFinite(precioUsd) || precioUsd < 0) throw bizError(400, 'El precio en USD no es válido');
    return {
        abonoId: abono.id,
        moneda: 'USD',
        precioAnterior: precioActual,
        precioNuevo: precioUsd,
        tipo: 'cotizacion',
        porcentaje: null,
        cotizacion: cotiz,
        precioPesos: redondear(precioUsd * cotiz, config.redondeo),
    };
};

/**
 * Trae abonos ACTIVOS por ids (regla dura: los inactivos/eliminados no se actualizan
 * ni facturan; se descartan silenciosamente como en el legado).
 * @param {object} models - Modelos de la app.
 * @param {number[]} ids - Ids seleccionados.
 * @returns {Promise<object[]>} Abonos activos con cliente/servicio.
 * @throws {Error} 400 si no queda ninguno activo.
 */
const getAbonosActivos = async (models, ids) => {
    const rows = await models.Abono.findAll({
        where: { id: { [Op.in]: ids }, activo: true },
        include: abonoIncludes(models),
    });
    if (!rows.length) throw bizError(400, 'No hay abonos activos entre los seleccionados');
    return rows;
};

/**
 * Preview de actualización masiva (o individual con un solo id). Puro: no escribe.
 * @param {object} models - Modelos de la app.
 * @param {number[]} ids - Abonos seleccionados.
 * @param {object} input - { porcentaje?, cotizacion?, overrides? ({id: pct}) }.
 * @returns {Promise<{rows: object[], config: object}>} Cálculo por abono.
 */
export const previewActualizacion = async (models, ids, input) => {
    const config = await getConfigAbonos(models);
    const abonos = await getAbonosActivos(models, ids);
    const overrides = input.overrides || {};
    const rows = abonos.map(a => {
        const abono = a.toJSON();
        const own = { ...input, porcentaje: overrides[abono.id] ?? input.porcentaje };
        return { ...calcularActualizacion(abono, own, config), cliente: abono.cliente?.nombre, servicio: abono.servicio?.nombre, descripcion: abono.descripcion };
    });
    return { rows, config };
};

/**
 * Aplica una actualización (individual o masiva) en UNA transacción, idempotente por
 * operationId: si ya se aplicó, devuelve lo aplicado sin re-ejecutar.
 * Fija `fechaUltimaActualizacion` al día 1 del mes corriente (regla del legado).
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién aplica.
 * @param {number[]} ids - Abonos seleccionados.
 * @param {object} input - { porcentaje?, cotizacion?, overrides? }.
 * @param {string} operationId - UUID del cliente para idempotencia.
 * @returns {Promise<{aplicados: number, rows: object[], idempotente?: boolean}>}
 */
export const aplicarActualizacion = async (models, userId, ids, input, operationId) => {
    const { Abono, AbonoActualizacion } = models;

    // Idempotencia: si este operationId ya escribió historial, devolvemos eso mismo.
    const previa = await AbonoActualizacion.findOne({ where: { operationId } });
    if (previa) {
        const rows = await AbonoActualizacion.findAll({ where: { operationId } });
        return { aplicados: rows.length, rows: rows.map(r => r.toJSON()), idempotente: true };
    }

    const { rows } = await previewActualizacion(models, ids, input);

    const hoy = new Date();
    const fechaAct = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;

    const tx = await Abono.sequelize.transaction();
    try {
        for (const r of rows) {
            await Abono.update(
                { precio: r.precioNuevo, fechaUltimaActualizacion: fechaAct },
                { where: { id: r.abonoId }, transaction: tx }
            );
            await AbonoActualizacion.create({
                abonoId: r.abonoId,
                fecha: fechaAct,
                moneda: r.moneda,
                precioAnterior: r.precioAnterior,
                precioNuevo: r.precioNuevo,
                tipo: r.tipo,
                porcentaje: r.porcentaje,
                cotizacion: r.cotizacion,
                precioPesos: r.precioPesos,
                userId,
                operationId,
            }, { transaction: tx });
        }
        await tx.commit();
    } catch (e) {
        await tx.rollback();
        throw e;
    }
    return { aplicados: rows.length, rows };
};

// ─── Facturación mensual ─────────────────────────────────────────────────────

/**
 * Normaliza y valida un período (año 2000..2100, mes 1..12).
 * @param {number|string} anio - Año.
 * @param {number|string} mes - Mes.
 * @returns {{anio: number, mes: number}}
 * @throws {Error} 400 si el período es inválido.
 */
const checkPeriodo = (anio, mes) => {
    const a = Number(anio), m = Number(mes);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw bizError(400, 'Mes inválido');
    if (!Number.isInteger(a) || a < 2000 || a > 2100) throw bizError(400, 'Año inválido');
    return { anio: a, mes: m };
};

/**
 * Preview de facturación de un período: qué se factura, qué ya estaba facturado y el total.
 * Puro: no escribe.
 * @param {object} models - Modelos de la app.
 * @param {number[]} ids - Abonos seleccionados.
 * @param {number} anioIn - Año del período.
 * @param {number} mesIn - Mes del período.
 * @returns {Promise<{rows: object[], total: number, aFacturar: number, yaFacturados: number, cotizacion: number}>}
 */
export const previewFacturacion = async (models, ids, anioIn, mesIn) => {
    const { anio, mes } = checkPeriodo(anioIn, mesIn);
    const { Facturacion } = models;
    const config = await getConfigAbonos(models);
    const abonos = await getAbonosActivos(models, ids);

    // Facturaciones VIGENTES (no anuladas) del período para estos abonos.
    const vigentes = await Facturacion.findAll({
        where: { anio, mes, abonoId: { [Op.in]: abonos.map(a => a.id) }, anuladaAt: null },
        attributes: ['abonoId'],
        raw: true,
    });
    const yaSet = new Set(vigentes.map(v => v.abonoId));

    let total = 0;
    const rows = abonos.map(a => {
        const abono = a.toJSON();
        const montoPesos = precioEnPesos(abono, config.cotizacion, config.redondeo);
        const ya = yaSet.has(abono.id);
        if (!ya) total += montoPesos;
        return {
            abonoId: abono.id,
            cliente: abono.cliente?.nombre,
            servicio: abono.servicio?.nombre,
            descripcion: abono.descripcion,
            moneda: abono.moneda,
            precio: Number(abono.precio),
            montoPesos,
            yaFacturado: ya,
        };
    });

    return { anio, mes, rows, total, aFacturar: rows.filter(r => !r.yaFacturado).length, yaFacturados: yaSet.size, cotizacion: config.cotizacion };
};

/**
 * Factura un período en UNA transacción, idempotente por operationId. Congela precio,
 * cotización (solo USD) y montoPesos. Los ya facturados (vigentes) se omiten.
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién factura.
 * @param {number[]} ids - Abonos seleccionados.
 * @param {number} anio - Año del período.
 * @param {number} mes - Mes del período.
 * @param {string} operationId - UUID del cliente para idempotencia.
 * @returns {Promise<{facturados: number, total: number, omitidos: number, idempotente?: boolean}>}
 */
export const aplicarFacturacion = async (models, userId, ids, anio, mes, operationId) => {
    const { Facturacion } = models;

    const previas = await Facturacion.findAll({ where: { operationId } });
    if (previas.length) {
        const total = previas.reduce((acc, f) => acc + Number(f.montoPesos), 0);
        return { facturados: previas.length, total, omitidos: 0, idempotente: true };
    }

    const preview = await previewFacturacion(models, ids, anio, mes);
    const aFacturar = preview.rows.filter(r => !r.yaFacturado);
    const config = await getConfigAbonos(models);
    const hoy = new Date().toISOString().slice(0, 10);

    // Snapshot de clienteId/servicioId desde los abonos (redundancia intencional).
    const abonos = await models.Abono.findAll({ where: { id: { [Op.in]: aFacturar.map(r => r.abonoId) } }, raw: true });
    const porId = Object.fromEntries(abonos.map(a => [a.id, a]));

    const tx = await Facturacion.sequelize.transaction();
    try {
        for (const r of aFacturar) {
            const abono = porId[r.abonoId];
            // Re-chequeo dentro de la transacción (carrera entre dos usuarios facturando).
            const vigente = await Facturacion.findOne({
                where: { abonoId: r.abonoId, anio: preview.anio, mes: preview.mes, anuladaAt: null },
                transaction: tx, lock: tx.LOCK.UPDATE,
            });
            if (vigente) continue;
            await Facturacion.create({
                abonoId: r.abonoId,
                clienteId: abono.clienteId,
                servicioId: abono.servicioId,
                anio: preview.anio,
                mes: preview.mes,
                moneda: r.moneda,
                precio: r.precio,
                cotizacion: r.moneda === 'USD' ? config.cotizacion : null,
                montoPesos: r.montoPesos,
                fecha: hoy,
                userId,
                operationId,
            }, { transaction: tx });
        }
        await tx.commit();
    } catch (e) {
        await tx.rollback();
        throw e;
    }

    // El total y el conteo reales salen de lo efectivamente insertado (bug #13 del legado:
    // el mensaje mostraba el total previsto, no el insertado).
    const insertadas = await Facturacion.findAll({ where: { operationId } });
    const total = insertadas.reduce((acc, f) => acc + Number(f.montoPesos), 0);
    return { facturados: insertadas.length, total, omitidos: preview.yaFacturados };
};

/**
 * Lista facturaciones (histórico) con filtros y paginación. Las anuladas se excluyen
 * por defecto (incluirAnuladas=true las muestra, marcadas).
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - { anio, mes, clienteId, abonoId, incluirAnuladas, page, limit }.
 * @returns {Promise<{rows: object[], count: number, page: number, limit: number, totalPesos: number}>}
 */
/** Columnas ordenables del listado de facturaciones. */
const ordenFacturaciones = (models) => ({
    periodo: [['anio', 'ASC'], ['mes', 'ASC']],
    cliente: [[models.Cliente, 'nombre', 'ASC']],
    servicio: [[models.Servicio, 'nombre', 'ASC']],
    precio: [['moneda', 'ASC'], ['precio', 'ASC']],
    montoPesos: [['montoPesos', 'ASC']],
    facturadaAt: [['facturadaAt', 'ASC']],
    anuladaAt: [['anuladaAt', 'ASC']],
});

export const listFacturaciones = async (models, query = {}) => {
    const { Facturacion, Cliente, Servicio, User } = models;
    const where = {};
    if (query.anio) where.anio = Number(query.anio);
    if (query.mes) where.mes = Number(query.mes);
    if (query.clienteId) where.clienteId = Number(query.clienteId);
    if (query.abonoId) where.abonoId = Number(query.abonoId);
    if (query.incluirAnuladas !== 'true') where.anuladaAt = null;

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);

    const { rows, count } = await Facturacion.findAndCountAll({
        where,
        include: [
            { model: Cliente, attributes: ['id', 'nombre'] },
            { model: Servicio, attributes: ['id', 'nombre'] },
            ...(User ? [{ model: User, attributes: ['id', 'name', 'lastName'] }] : []),
        ],
        limit,
        offset: (page - 1) * limit,
        order: ordenSeguro(query, ordenFacturaciones(models), [['anio', 'DESC'], ['mes', 'DESC'], ['id', 'DESC']]),
        distinct: true,
    });

    // Total en pesos del set filtrado completo (solo vigentes, para el tile).
    const totalPesos = Number(await Facturacion.sum('montoPesos', { where: { ...where, anuladaAt: null } })) || 0;

    return { rows: rows.map(r => r.toJSON()), count, page, limit, totalPesos };
};

/**
 * Anula una facturación (no-destructivo, auditado). El período queda re-facturable.
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién anula.
 * @param {number} id - Facturación a anular.
 * @param {string} motivo - Motivo (obligatorio: la anulación siempre se explica).
 * @returns {Promise<object|null>} La facturación anulada o null si no existe.
 * @throws {Error} 400 si ya estaba anulada.
 */
export const anularFacturacion = async (models, userId, id, motivo) => {
    const { Facturacion } = models;
    const fact = await Facturacion.findByPk(id);
    if (!fact) return null;
    if (fact.anuladaAt) throw bizError(400, 'La facturación ya estaba anulada');
    await fact.update({ anuladaAt: new Date(), anuladaPor: userId, motivoAnulacion: motivo });
    return fact;
};
