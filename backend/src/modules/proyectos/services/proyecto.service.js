/**
 * Service del módulo `proyectos` — proyectos + cobranzas en cuotas (USD) con auditoría.
 *
 * Reglas preservadas del legado (../analisis_app_php/05 §2) con las correcciones del PRD:
 *  - Cuotas SIEMPRE en USD; tope = presupuesto convertido a USD (0 = sin tope; tolerancia
 *    +0.001). Cobrar: se ingresa el PESO REAL y se deriva la cotización (inverso a abonos).
 *  - Una cuota COBRADA no se mueve, no se edita ni se elimina (bugs #3/#4 del legado);
 *    primero se descobra — y TODO queda auditado en CobranzaEvento (mejora §10.3).
 *  - Un proyecto con cobranzas cobradas no se elimina (evita el agujero retroactivo en la
 *    estadística que tenía el legado); las cuotas pendientes se eliminan con él.
 */

import { Op } from 'sequelize';
import { getAppConfigNumber } from '../../../kernel/index.js';
import { ESTADOS_PROYECTO } from '../models/Proyecto.js';

/** Estados que cierran el proyecto (sin alertas de entrega). */
export const ESTADOS_CERRADOS = ['finalizado', 'finalizado_incompleto'];

/** Tolerancia de punto flotante del tope de presupuesto (regla del legado). */
const TOLERANCIA = 0.001;

/**
 * Error de negocio con status.
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje para el usuario.
 * @returns {Error} Error enriquecido.
 */
const bizError = (statusCode, message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

/** Fragmento SQL de los días hasta la entrega estimada (null si no hay fecha). */
const SQL_DIAS_ENTREGA = 'DATEDIFF(`proyectos`.`fechaEstimadaEntrega`, CURDATE())';

/**
 * Cotización vigente.
 * @param {object} models - Modelos de la app.
 * @returns {Promise<number>} Cotización del dólar.
 */
const getCotizacion = (models) => getAppConfigNumber(models, 'COTIZACION_DOLAR');

/**
 * Presupuesto del proyecto EN USD (para el tope de planificación).
 * ARS con cotización 0 → 0 = "sin tope" (documentado; igual que el legado).
 * @param {{moneda: string, total: number|string}} proyecto - Proyecto.
 * @param {number} cotizacion - Cotización vigente.
 * @returns {number} Presupuesto en USD.
 */
export const presupuestoUsd = (proyecto, cotizacion) => {
    const total = Number(proyecto.total);
    if (proyecto.moneda === 'USD') return total;
    return cotizacion > 0 ? total / cotizacion : 0;
};

/**
 * Equivalente en pesos de una cuota: congelado si está cobrada, al dólar vigente si no.
 * @param {object} cobranza - Cuota (raw o JSON).
 * @param {number} cotizacion - Cotización vigente.
 * @returns {number} Pesos.
 */
export const cobranzaEnPesos = (cobranza, cotizacion) =>
    (cobranza.cobrado && cobranza.montoPesos !== null)
        ? Number(cobranza.montoPesos)
        : Number(cobranza.montoUsd) * cotizacion;

/**
 * Registra un evento de auditoría de cobranza (best-effort dentro del flujo que lo llama).
 * @param {object} models - Modelos de la app.
 * @param {object} cobranza - Cuota afectada.
 * @param {string} tipo - Tipo de evento.
 * @param {string} detalle - Detalle legible.
 * @param {number|null} userId - Quién.
 * @param {object} [tx] - Transacción opcional.
 * @returns {Promise<void>}
 */
const registrarEvento = (models, cobranza, tipo, detalle, userId, tx) =>
    models.CobranzaEvento.create(
        { cobranzaId: cobranza.id, proyectoId: cobranza.proyectoId, tipo, detalle, userId },
        tx ? { transaction: tx } : {}
    );

/** Includes estándar del proyecto. */
const proyectoIncludes = (models) => [
    { model: models.Cliente, attributes: ['id', 'nombre'] },
    {
        model: models.Servicio,
        attributes: ['id', 'nombre', 'areaId'],
        include: models.Area ? [{ model: models.Area, attributes: ['id', 'nombre'] }] : [],
    },
];

// ─── Proyectos ───────────────────────────────────────────────────────────────

/**
 * Lista proyectos con filtros y paginación. `diasParaEntrega` se calcula en SQL.
 * Orden del legado: abiertos primero, entrega más próxima primero (sin fecha al final).
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - { estado (CSV), clienteId, search, page, limit }.
 * @returns {Promise<{rows: object[], count: number, page: number, limit: number}>}
 */
export const listProyectos = async (models, query = {}) => {
    const { Proyecto } = models;
    const where = {};
    if (query.estado) {
        const estados = String(query.estado).split(',').filter(e => ESTADOS_PROYECTO.includes(e));
        if (estados.length) where.estado = { [Op.in]: estados };
    }
    if (query.clienteId) where.clienteId = Number(query.clienteId);
    if (query.search) where.nombre = { [Op.like]: `%${query.search}%` };

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 200);

    const { rows, count } = await Proyecto.findAndCountAll({
        where,
        include: proyectoIncludes(models),
        attributes: { include: [[Proyecto.sequelize.literal(SQL_DIAS_ENTREGA), 'diasParaEntrega']] },
        limit,
        offset: (page - 1) * limit,
        order: [
            [Proyecto.sequelize.literal(`\`proyectos\`.\`estado\` IN ('finalizado','finalizado_incompleto')`), 'ASC'],
            [Proyecto.sequelize.literal('`proyectos`.`fechaEstimadaEntrega` IS NULL'), 'ASC'],
            ['fechaEstimadaEntrega', 'ASC'],
            [models.Cliente, 'nombre', 'ASC'],
        ],
        distinct: true,
    });

    return { rows: rows.map(r => r.toJSON()), count, page, limit };
};

/**
 * Un proyecto por id (con cliente, servicio+área y días de entrega).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del proyecto.
 * @returns {Promise<object|null>} El proyecto o null.
 */
export const getProyecto = async (models, id) => {
    const { Proyecto } = models;
    const p = await Proyecto.findByPk(id, {
        include: proyectoIncludes(models),
        attributes: { include: [[Proyecto.sequelize.literal(SQL_DIAS_ENTREGA), 'diasParaEntrega']] },
    });
    return p ? p.toJSON() : null;
};

/**
 * Valida las FKs de un proyecto.
 * @param {object} models - Modelos de la app.
 * @param {object} data - { clienteId?, servicioId? }.
 * @returns {Promise<void>}
 * @throws {Error} 400 con el campo inválido.
 */
const checkRefs = async (models, data) => {
    if (data.clienteId !== undefined) {
        const cliente = await models.Cliente.findByPk(data.clienteId);
        if (!cliente) throw bizError(400, 'El cliente seleccionado no existe');
    }
    if (data.servicioId) {
        const servicio = await models.Servicio.findByPk(data.servicioId);
        if (!servicio) throw bizError(400, 'El servicio seleccionado no existe');
    }
};

/**
 * Crea un proyecto.
 * @param {object} models - Modelos de la app.
 * @param {object} data - Datos validados.
 * @returns {Promise<object>} El proyecto creado.
 */
export const createProyecto = async (models, data) => {
    await checkRefs(models, data);
    const created = await models.Proyecto.create({ ...data, servicioId: data.servicioId || null });
    return getProyecto(models, created.id);
};

/**
 * Actualiza un proyecto.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id a editar.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object|null>} El proyecto actualizado o null.
 */
export const updateProyecto = async (models, id, data) => {
    const proyecto = await models.Proyecto.findByPk(id);
    if (!proyecto) return null;
    await checkRefs(models, data);
    await proyecto.update({ ...data, ...(data.servicioId !== undefined && { servicioId: data.servicioId || null }) });
    return getProyecto(models, id);
};

/**
 * Elimina (soft) un proyecto. Protección: con cobranzas COBRADAS no se elimina — el
 * legado lo permitía y la estadística perdía facturación retroactivamente. Las cuotas
 * pendientes se eliminan con él (soft, auditadas).
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién elimina.
 * @param {number} id - Id del proyecto.
 * @returns {Promise<boolean>} true si se eliminó.
 * @throws {Error} 409 si tiene cobranzas cobradas.
 */
export const deleteProyecto = async (models, userId, id) => {
    const { Proyecto, Cobranza } = models;
    const proyecto = await Proyecto.findByPk(id);
    if (!proyecto) return false;

    const cobradas = await Cobranza.count({ where: { proyectoId: id, cobrado: true } });
    if (cobradas > 0) {
        throw bizError(409, `No se puede eliminar: el proyecto tiene ${cobradas} cobranza(s) cobrada(s). Su facturación es parte del histórico.`);
    }

    const pendientes = await Cobranza.findAll({ where: { proyectoId: id } });
    const tx = await Proyecto.sequelize.transaction();
    try {
        for (const cuota of pendientes) {
            await registrarEvento(models, cuota, 'eliminada', 'Eliminada junto con el proyecto', userId, tx);
            await cuota.destroy({ transaction: tx });
        }
        await proyecto.destroy({ transaction: tx });
        await tx.commit();
    } catch (e) {
        await tx.rollback();
        throw e;
    }
    return true;
};

// ─── Cobranzas de un proyecto ────────────────────────────────────────────────

/**
 * Suma planificada del proyecto (cobradas + pendientes), en USD.
 * @param {object} models - Modelos de la app.
 * @param {number} proyectoId - Proyecto.
 * @param {number} [excluirId] - Cuota a excluir (edición de monto).
 * @returns {Promise<number>} Total planificado en USD.
 */
const sumarPlanificado = async (models, proyectoId, excluirId = 0) => {
    const where = { proyectoId };
    if (excluirId) where.id = { [Op.ne]: excluirId };
    return Number(await models.Cobranza.sum('montoUsd', { where })) || 0;
};

/**
 * Valida el tope de presupuesto para un monto nuevo.
 * @param {object} models - Modelos de la app.
 * @param {object} proyecto - Proyecto (raw).
 * @param {number} montoUsd - Monto a validar.
 * @param {number} [excluirId] - Cuota a excluir.
 * @returns {Promise<void>}
 * @throws {Error} 400 con el disponible.
 */
const checkTope = async (models, proyecto, montoUsd, excluirId = 0) => {
    const cotizacion = await getCotizacion(models);
    const presUsd = presupuestoUsd(proyecto, cotizacion);
    if (presUsd <= 0) return; // sin tope
    const planificado = await sumarPlanificado(models, proyecto.id, excluirId);
    const disponible = presUsd - planificado;
    if (montoUsd > disponible + TOLERANCIA) {
        throw bizError(400, `El monto supera el presupuesto del proyecto. Disponible para planificar: US$ ${Math.max(Math.round(disponible * 100) / 100, 0)}`);
    }
};

/**
 * Cobranzas del proyecto + KPIs (planificado, cobrado, faltas) + eventos de auditoría.
 * @param {object} models - Modelos de la app.
 * @param {number} proyectoId - Proyecto.
 * @returns {Promise<object>} { proyecto, cuotas, kpis, eventos }.
 */
export const getCobranzas = async (models, proyectoId) => {
    const proyecto = await getProyecto(models, proyectoId);
    if (!proyecto) return null;

    const cotizacion = await getCotizacion(models);
    const cuotas = await models.Cobranza.findAll({
        where: { proyectoId },
        order: [['anio', 'ASC'], ['mes', 'ASC'], ['id', 'ASC']],
    });

    const presUsd = presupuestoUsd(proyecto, cotizacion);
    let planUsd = 0, cobradoUsd = 0, cobradoPesos = 0;
    const shaped = cuotas.map(c => {
        const cuota = c.toJSON();
        planUsd += Number(cuota.montoUsd);
        if (cuota.cobrado) {
            cobradoUsd += Number(cuota.montoUsd);
            cobradoPesos += Number(cuota.montoPesos || 0);
        }
        return { ...cuota, enPesos: cobranzaEnPesos(cuota, cotizacion) };
    });

    const eventos = await models.CobranzaEvento.findAll({
        where: { proyectoId },
        include: models.User ? [{ model: models.User, attributes: ['id', 'name', 'lastName'] }] : [],
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit: 50,
    });

    return {
        proyecto,
        cuotas: shaped,
        kpis: {
            cotizacion,
            presupuestoUsd: presUsd,
            planUsd,
            cobradoUsd,
            cobradoPesos,
            faltaPlanificar: Math.max(presUsd - planUsd, 0),
            // Sin presupuesto, "falta cobrar" se mide contra lo planificado (regla del legado).
            faltaCobrar: Math.max((presUsd > 0 ? presUsd : planUsd) - cobradoUsd, 0),
        },
        eventos: eventos.map(e => e.toJSON()),
    };
};

/**
 * Agrega una cuota (respetando el tope de presupuesto). Auditada.
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién.
 * @param {number} proyectoId - Proyecto.
 * @param {{anio: number, mes: number, montoUsd: number}} data - Datos validados.
 * @returns {Promise<object>} La cuota creada.
 */
export const addCobranza = async (models, userId, proyectoId, data) => {
    const proyecto = await models.Proyecto.findByPk(proyectoId);
    if (!proyecto) throw bizError(404, 'Proyecto no encontrado');
    await checkTope(models, proyecto, data.montoUsd);

    const cuota = await models.Cobranza.create({ proyectoId, anio: data.anio, mes: data.mes, montoUsd: data.montoUsd });
    await registrarEvento(models, cuota, 'creada', `US$ ${data.montoUsd} · ${data.mes}/${data.anio}`, userId);
    return cuota;
};

/**
 * Busca una cuota SCOPED por proyecto (toda mutación de cuota exige el proyecto — el
 * legado tenía un endpoint sin scoping, bug #5).
 * @param {object} models - Modelos de la app.
 * @param {number} proyectoId - Proyecto dueño.
 * @param {number} cobranzaId - Cuota.
 * @returns {Promise<object>} La cuota.
 * @throws {Error} 404 si no existe en ese proyecto.
 */
const getCuota = async (models, proyectoId, cobranzaId) => {
    const cuota = await models.Cobranza.findOne({ where: { id: cobranzaId, proyectoId } });
    if (!cuota) throw bizError(404, 'Cobranza no encontrada en este proyecto');
    return cuota;
};

/**
 * Edita el monto USD de una cuota PENDIENTE (cobrada → 400, bug #4 del legado). Auditada.
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién.
 * @param {number} proyectoId - Proyecto.
 * @param {number} cobranzaId - Cuota.
 * @param {number} montoUsd - Monto nuevo (> 0).
 * @returns {Promise<object>} La cuota actualizada.
 */
export const updateMonto = async (models, userId, proyectoId, cobranzaId, montoUsd) => {
    const proyecto = await models.Proyecto.findByPk(proyectoId);
    if (!proyecto) throw bizError(404, 'Proyecto no encontrado');
    const cuota = await getCuota(models, proyectoId, cobranzaId);
    if (cuota.cobrado) throw bizError(400, 'La cuota ya está cobrada: descobrala antes de editar el monto');
    await checkTope(models, proyecto, montoUsd, cuota.id);

    const anterior = Number(cuota.montoUsd);
    await cuota.update({ montoUsd });
    await registrarEvento(models, cuota, 'monto_editado', `US$ ${anterior} → US$ ${montoUsd}`, userId);
    return cuota;
};

/**
 * Mueve cuotas PENDIENTES a otro período (cobradas → 400). Scoped por proyecto. Auditada.
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién.
 * @param {number} proyectoId - Proyecto dueño de TODAS las cuotas.
 * @param {number[]} cobranzaIds - Cuotas a mover.
 * @param {number} anio - Año destino.
 * @param {number} mes - Mes destino.
 * @returns {Promise<number>} Cuántas se movieron.
 */
export const moverCobranzas = async (models, userId, proyectoId, cobranzaIds, anio, mes) => {
    const cuotas = await models.Cobranza.findAll({
        where: { id: { [Op.in]: cobranzaIds }, proyectoId },
    });
    if (!cuotas.length) throw bizError(404, 'No se encontraron cobranzas de ese proyecto');
    if (cuotas.some(c => c.cobrado)) throw bizError(400, 'Hay cuotas cobradas en la selección: las cobradas no se mueven');

    for (const cuota of cuotas) {
        const desde = `${cuota.mes}/${cuota.anio}`;
        await cuota.update({ anio, mes });
        await registrarEvento(models, cuota, 'movida', `${desde} → ${mes}/${anio}`, userId);
    }
    return cuotas.length;
};

/**
 * Cobra una cuota: se ingresa el PESO REAL y se deriva la cotización (inverso a abonos,
 * regla del legado). Congela montoPesos + cotización + fecha de cobro (hoy). Auditada.
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién.
 * @param {number} proyectoId - Proyecto.
 * @param {number} cobranzaId - Cuota.
 * @param {number} montoPesos - Peso real cobrado (> 0).
 * @returns {Promise<object>} La cuota cobrada.
 */
export const cobrarCuota = async (models, userId, proyectoId, cobranzaId, montoPesos) => {
    const cuota = await getCuota(models, proyectoId, cobranzaId);
    if (cuota.cobrado) throw bizError(400, 'La cuota ya está cobrada');

    const usd = Number(cuota.montoUsd);
    const cotizacion = usd > 0 ? Math.round((montoPesos / usd) * 100) / 100 : null;
    const hoy = new Date().toISOString().slice(0, 10);
    await cuota.update({ cobrado: true, montoPesos, cotizacion, fechaCobro: hoy });
    await registrarEvento(models, cuota, 'cobrada', `$ ${montoPesos}${cotizacion ? ` @ ${cotizacion}` : ''}`, userId);
    return cuota;
};

/**
 * Deshace un cobro (accesible — el legado lo tenía roto, bug #2). Los datos del cobro
 * quedan preservados en el evento de auditoría antes de limpiarse.
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién.
 * @param {number} proyectoId - Proyecto.
 * @param {number} cobranzaId - Cuota.
 * @returns {Promise<object>} La cuota pendiente de nuevo.
 */
export const descobrarCuota = async (models, userId, proyectoId, cobranzaId) => {
    const cuota = await getCuota(models, proyectoId, cobranzaId);
    if (!cuota.cobrado) throw bizError(400, 'La cuota no está cobrada');

    const detalle = `Era $ ${cuota.montoPesos}${cuota.cotizacion ? ` @ ${cuota.cotizacion}` : ''} del ${cuota.fechaCobro}`;
    await registrarEvento(models, cuota, 'descobrada', detalle, userId);
    await cuota.update({ cobrado: false, montoPesos: null, cotizacion: null, fechaCobro: null });
    return cuota;
};

/**
 * Elimina (soft) una cuota PENDIENTE (cobrada → 400: primero descobrar). Auditada.
 * @param {object} models - Modelos de la app.
 * @param {number|null} userId - Quién.
 * @param {number} proyectoId - Proyecto.
 * @param {number} cobranzaId - Cuota.
 * @returns {Promise<boolean>} true si se eliminó.
 */
export const deleteCobranza = async (models, userId, proyectoId, cobranzaId) => {
    const cuota = await getCuota(models, proyectoId, cobranzaId);
    if (cuota.cobrado) throw bizError(400, 'La cuota está cobrada: descobrala antes de eliminarla');
    await registrarEvento(models, cuota, 'eliminada', `US$ ${cuota.montoUsd} · ${cuota.mes}/${cuota.anio}`, userId);
    await cuota.destroy();
    return true;
};

// ─── Grilla anual global ─────────────────────────────────────────────────────

/**
 * Grilla anual: todos los proyectos (con fila vacía incluida) × 12 meses, celdas con
 * pesos (congelado o al dólar), USD, cuántas cobradas y los ids (para el drag & drop).
 * @param {object} models - Modelos de la app.
 * @param {number} anio - Año a mostrar.
 * @returns {Promise<object>} { anio, anios, cotizacion, filas, totalesMes, granTotal }.
 */
export const getGrillaAnual = async (models, anio) => {
    const { Proyecto, Cobranza } = models;
    const cotizacion = await getCotizacion(models);

    // Años disponibles (con cuotas) + el pedido + el actual.
    const anioRows = await Cobranza.findAll({
        attributes: [[Cobranza.sequelize.fn('DISTINCT', Cobranza.sequelize.col('anio')), 'anio']],
        raw: true,
    });
    const anios = [...new Set([...anioRows.map(r => Number(r.anio)), Number(anio), new Date().getFullYear()])].sort();

    const proyectos = await Proyecto.findAll({
        include: [{ model: models.Cliente, attributes: ['id', 'nombre'] }],
        order: [
            [Proyecto.sequelize.literal('`proyectos`.`fechaConfirmacion` IS NULL'), 'ASC'],
            ['fechaConfirmacion', 'ASC'],
            [models.Cliente, 'nombre', 'ASC'],
        ],
    });

    const cuotas = await Cobranza.findAll({ where: { anio }, raw: true });

    const filas = proyectos.map(p => {
        const proyecto = p.toJSON();
        const celdas = {};
        let totalPesos = 0, totalUsd = 0;
        for (let mes = 1; mes <= 12; mes++) {
            const delMes = cuotas.filter(c => c.proyectoId === proyecto.id && c.mes === mes);
            if (!delMes.length) { celdas[mes] = null; continue; }
            const pesos = delMes.reduce((acc, c) => acc + cobranzaEnPesos(c, cotizacion), 0);
            const usd = delMes.reduce((acc, c) => acc + Number(c.montoUsd), 0);
            const cobradas = delMes.filter(c => c.cobrado).length;
            totalPesos += pesos;
            totalUsd += usd;
            celdas[mes] = { pesos, usd, cobradas, cantidad: delMes.length, ids: delMes.map(c => c.id) };
        }
        return {
            id: proyecto.id,
            nombre: proyecto.nombre,
            cliente: proyecto.cliente?.nombre,
            moneda: proyecto.moneda,
            total: Number(proyecto.total),
            estado: proyecto.estado,
            celdas,
            totalPesos,
            totalUsd,
        };
    });

    const totalesMes = {};
    for (let mes = 1; mes <= 12; mes++) {
        totalesMes[mes] = filas.reduce((acc, f) => acc + (f.celdas[mes]?.pesos || 0), 0);
    }
    const granTotal = filas.reduce((acc, f) => acc + f.totalPesos, 0);

    return { anio: Number(anio), anios, cotizacion, filas, totalesMes, granTotal };
};
