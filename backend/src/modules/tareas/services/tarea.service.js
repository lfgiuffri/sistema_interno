/**
 * Service del módulo `tareas` — listas, tareas, filtros, historial de estados y resúmenes.
 *
 * Reglas duras del legado (../analisis_app_php/03):
 *  - DOS capas de permiso: capability de sección + ver/editar del espacio (ninguna reemplaza
 *    a la otra). El acceso a una tarea se controla por EL ESPACIO DE LA TAREA.
 *  - La edición rápida NO toca descripción ni estado (§5.12).
 *  - Historial append-only; no anota si el estado no cambió (§5.15).
 *  - Asignables: activos con rol admin o tareas:update; no mira el espacio (§5.18).
 *  - Fuente ÚNICA de condiciones por categoría: el número y el listado usan el mismo SQL.
 *  - Orden del listado: completadas al final → prioridad (rojo→verde) → sin fecha al final
 *    → vencimiento asc → creada desc.
 * Mejoras: mover de lista/espacio (§10.5, validando editar en ambos), estado inválido → 422
 * (el legado lo convertía en 'abierta' y podía reabrir completadas — §5.13).
 */

import { Op } from 'sequelize';
import { getRoleCapabilities, getAppConfigNumber, crearNotificacion } from '../../../kernel/index.js';
import { ESTADOS_TAREA, ESTADOS_PENDIENTES, PRIORIDADES_TAREA } from '../models/Tarea.js';
import { getEspacioPermisos, exigirEspacioVer, exigirEspacioEditar } from '../../espacios/services/espacio.service.js';
import { sanearHtml } from '../../../services/html/sanitizador.service.js';
import { ligarImagenes } from './archivo.service.js';

export { ESTADOS_TAREA, ESTADOS_PENDIENTES, PRIORIDADES_TAREA };

/**
 * Error de negocio con status (el controller lo mapea al envelope).
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje para el usuario.
 * @param {object} [extra] - Campos extra.
 * @returns {Error} Error enriquecido.
 */
const bizError = (statusCode, message, extra = {}) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    Object.assign(err, extra);
    return err;
};

/** Lista SQL segura de estados pendientes (valores propios, no input). */
const SQL_PENDIENTES = ESTADOS_PENDIENTES.map(e => `'${e}'`).join(',');

/**
 * Fragmentos SQL por categoría — FUENTE ÚNICA compartida por conteos y listados
 * (garantía del legado: el número de la tarjeta coincide con el listado destino).
 * @param {number} dias - Ventana de "por vencer".
 * @returns {Record<string, string>} Condición SQL por categoría (sobre alias `tareas`).
 */
const sqlCategorias = (dias) => ({
    pendientes: `\`tareas\`.\`estado\` IN (${SQL_PENDIENTES})`,
    hoy: `\`tareas\`.\`estado\` IN (${SQL_PENDIENTES}) AND \`tareas\`.\`fechaVencimiento\` = CURDATE()`,
    por_vencer: `\`tareas\`.\`estado\` IN (${SQL_PENDIENTES}) AND \`tareas\`.\`fechaVencimiento\` > CURDATE() AND \`tareas\`.\`fechaVencimiento\` <= DATE_ADD(CURDATE(), INTERVAL ${Number(dias)} DAY)`,
    vencidas: `\`tareas\`.\`estado\` IN (${SQL_PENDIENTES}) AND \`tareas\`.\`fechaVencimiento\` < CURDATE()`,
    // Urgentes: la prioridad más alta del legado es 'rojo'.
    urgentes: `\`tareas\`.\`estado\` IN (${SQL_PENDIENTES}) AND \`tareas\`.\`prioridad\` = 'rojo'`,
    // Sin asignar: pendientes que no tienen dueño. Es distinto del alcance `u=sin`, que
    // filtra CUALQUIER categoría por sin-asignar; esto es una categoría propia con su conteo.
    sin_asignar: `\`tareas\`.\`estado\` IN (${SQL_PENDIENTES}) AND \`tareas\`.\`asignadoA\` IS NULL`
});

/** Metadatos de las categorías del resumen (labels y ayudas del legado). */
export const CATEGORIAS_META = {
    pendientes: { label: 'Tareas pendientes', ayuda: 'Todo lo que no está completado.' },
    hoy: { label: 'Para hacer hoy', ayuda: 'Vencen hoy.' },
    por_vencer: { label: 'Por vencer', ayuda: 'Vencen dentro de los próximos días configurados.' },
    vencidas: { label: 'Tareas vencidas', ayuda: 'Pasó la fecha de vencimiento y siguen abiertas.' },
    urgentes: { label: 'Urgentes', ayuda: 'Pendientes con prioridad urgente.' },
    sin_asignar: { label: 'Sin asignar', ayuda: 'Pendientes que todavía no tienen responsable.' }
};

/**
 * Días de aviso "por vencer" desde la config (clamp 1..60, default 3 — regla del legado).
 * @param {object} models - Modelos de la app.
 * @returns {Promise<number>} Días de la ventana.
 */
export const getDiasPorVencer = async (models) => {
    const n = await getAppConfigNumber(models, 'TAREAS_DIAS_POR_VENCER');
    if (!Number.isFinite(n)) return 3;
    return Math.min(Math.max(Math.trunc(n), 1), 60);
};

/**
 * ¿El rol tiene la capability (o el comodín)?
 * @param {object} models - Modelos de la app.
 * @param {number} roleId - Rol del usuario.
 * @param {string} cap - Capability a chequear.
 * @returns {Promise<boolean>} true si la tiene.
 */
const rolPuede = async (models, roleId, cap) => {
    const caps = await getRoleCapabilities(models, 'default', roleId);
    return caps.includes('*') || caps.includes(cap);
};

/**
 * Usuarios asignables: ACTIVOS con rol admin (`*`) o con `tareas:update`.
 * No mira el espacio (regla del legado §5.18: se valida también al guardar).
 * @param {object} models - Modelos de la app.
 * Incluye el `username` porque la misma lista alimenta el autocompletado de menciones
 * (@username) en los comentarios: el token que se inserta tiene que ser el username exacto.
 * @returns {Promise<object[]>} [{ id, nombre, username }] ordenados por nombre.
 */
export const usuariosAsignables = async (models) => {
    const { User, RoleCapability } = models;
    const roles = (await RoleCapability.findAll({
        where: { capability: { [Op.in]: ['*', 'tareas:update'] } },
        attributes: ['roleId'],
        raw: true
    })).map(r => r.roleId);
    if (!roles.length) return [];
    const users = await User.findAll({
        where: { active: true, roleId: { [Op.in]: [...new Set(roles)] } },
        attributes: ['id', 'name', 'lastName', 'username'],
        order: [['name', 'ASC'], ['lastName', 'ASC']]
    });
    return users.map(u => ({ id: u.id, nombre: `${u.name} ${u.lastName}`.trim(), username: u.username }));
};

/**
 * Valida que un usuario pueda recibir tareas (mismo criterio que usuariosAsignables).
 * @param {object} models - Modelos de la app.
 * @param {number} asignadoA - Usuario destino (>0).
 * @returns {Promise<void>}
 * @throws {Error} 400 si no puede trabajar en tareas.
 */
const validarAsignable = async (models, asignadoA) => {
    const user = await models.User.findByPk(asignadoA);
    if (!user || !user.active || !(await rolPuede(models, user.roleId, 'tareas:update'))) {
        throw bizError(400, 'El usuario asignado no puede trabajar en tareas');
    }
};

/**
 * Asignar a OTRO exige `tareas:asignar` (granularidad del PRD §4; asignarse a sí mismo no).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number|null} asignadoA - Destino de la asignación.
 * @param {number|null} asignadoActual - Asignado vigente (edición) para no exigir al no tocar.
 * @returns {Promise<void>}
 * @throws {Error} 403 sin la capability.
 */
const exigirPoderAsignar = async (models, user, asignadoA, asignadoActual = null) => {
    if (!asignadoA || asignadoA === user.id || asignadoA === asignadoActual) return;
    if (!(await rolPuede(models, user.roleId, 'tareas:asignar'))) {
        throw bizError(403, 'No tenés el permiso requerido: tareas:asignar');
    }
};

// ─────────────────────────── Home del módulo ───────────────────────────

/**
 * Resumen de columnas (fragmento único del legado §2.7) para un conjunto de tareas.
 * @param {object} models - Modelos de la app.
 * @param {number[]} espacioIds - Espacios a considerar ([] = nada, devuelve ceros).
 * @param {number|null} asignadoA - Filtrar por asignado (null = cualquiera).
 * @param {number} dias - Ventana de por vencer.
 * @returns {Promise<object>} Conteos { pendientes, hoy, porVencer, vencidas, enProgreso, pausadas, enRevision, sinFecha, urgentes }.
 */
const resumenColumnas = async (models, espacioIds, asignadoA, dias) => {
    const vacio = { pendientes: 0, hoy: 0, porVencer: 0, vencidas: 0, enProgreso: 0, pausadas: 0, enRevision: 0, sinFecha: 0, urgentes: 0 };
    if (!espacioIds.length) return vacio;
    const { Tarea } = models;
    const cat = sqlCategorias(dias);
    const S = (cond) => [Tarea.sequelize.literal(`COALESCE(SUM(${cond}), 0)`)];

    const where = { espacioId: { [Op.in]: espacioIds } };
    if (asignadoA !== null) where.asignadoA = asignadoA;

    const row = await Tarea.findOne({
        where,
        attributes: [
            [...S(cat.pendientes), 'pendientes'],
            [...S(cat.hoy), 'hoy'],
            [...S(cat.por_vencer), 'porVencer'],
            [...S(cat.vencidas), 'vencidas'],
            [...S(`\`tareas\`.\`estado\` = 'en_progreso'`), 'enProgreso'],
            [...S(`\`tareas\`.\`estado\` = 'pausada'`), 'pausadas'],
            [...S(`\`tareas\`.\`estado\` = 'en_revision'`), 'enRevision'],
            [...S(`${cat.pendientes} AND \`tareas\`.\`fechaVencimiento\` IS NULL`), 'sinFecha'],
            [...S(`${cat.pendientes} AND \`tareas\`.\`prioridad\` = 'rojo'`), 'urgentes']
        ],
        raw: true
    });
    return Object.fromEntries(Object.entries(row || vacio).map(([k, v]) => [k, Number(v) || 0]));
};

/**
 * Home del módulo: espacios visibles (activos) con agregados + resumen de MIS pendientes.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @returns {Promise<object>} { espacios, miResumen, diasPorVencer }.
 */
export const homeEspacios = async (models, user) => {
    const { EspacioTrabajo, Tarea, Lista } = models;
    const permisos = await getEspacioPermisos(models, user);
    const visiblesIds = Object.entries(permisos).filter(([, p]) => p.ver).map(([id]) => Number(id));
    const dias = await getDiasPorVencer(models);

    if (!visiblesIds.length) {
        return { espacios: [], miResumen: await resumenColumnas(models, [], user.id, dias), diasPorVencer: dias };
    }

    // Solo espacios ACTIVOS en la home (uno inactivo sigue accesible por URL — regla del legado).
    const espacios = await EspacioTrabajo.findAll({
        where: { id: { [Op.in]: visiblesIds }, activo: true },
        order: [['nombre', 'ASC']]
    });
    const activosIds = espacios.map(e => e.id);
    const cat = sqlCategorias(dias);

    // Agregados por espacio en UNA query (el legado asumía N+1; acá no).
    const [tareasAgg, listasAgg] = await Promise.all([
        activosIds.length ? Tarea.findAll({
            where: { espacioId: { [Op.in]: activosIds } },
            attributes: [
                'espacioId',
                [Tarea.sequelize.literal(`COALESCE(SUM(${cat.pendientes}), 0)`), 'pendientes'],
                [Tarea.sequelize.literal(`COALESCE(SUM(${cat.vencidas}), 0)`), 'vencidas']
            ],
            group: ['espacioId'],
            raw: true
        }) : [],
        activosIds.length && Lista ? Lista.findAll({
            where: { espacioId: { [Op.in]: activosIds } },
            attributes: ['espacioId', [Lista.sequelize.fn('COUNT', Lista.sequelize.col('id')), 'n']],
            group: ['espacioId'],
            raw: true
        }) : []
    ]);
    const tareasPorEspacio = Object.fromEntries(tareasAgg.map(r => [r.espacioId, r]));
    const listasPorEspacio = Object.fromEntries(listasAgg.map(r => [r.espacioId, Number(r.n)]));

    return {
        espacios: espacios.map(e => ({
            id: e.id,
            nombre: e.nombre,
            descripcion: e.descripcion,
            editar: !!permisos[e.id]?.editar,
            pendientes: Number(tareasPorEspacio[e.id]?.pendientes) || 0,
            vencidas: Number(tareasPorEspacio[e.id]?.vencidas) || 0,
            listas: listasPorEspacio[e.id] || 0
        })),
        miResumen: await resumenColumnas(models, visiblesIds, user.id, dias),
        diasPorVencer: dias
    };
};

// ─────────────────────────── Listas ───────────────────────────

/**
 * Busca un espacio o tira 404 con el mensaje del legado.
 * @param {object} models - Modelos de la app.
 * @param {number} espacioId - Espacio.
 * @returns {Promise<object>} El espacio.
 * @throws {Error} 404 si no existe.
 */
const buscarEspacio = async (models, espacioId) => {
    const espacio = await models.EspacioTrabajo.findByPk(espacioId);
    if (!espacio) throw bizError(404, 'Espacio de trabajo no encontrado');
    return espacio;
};

/**
 * Unicidad de nombre de lista POR ESPACIO contra no eliminadas (+ oferta de reactivación).
 * @param {object} models - Modelos de la app.
 * @param {number} espacioId - Espacio contenedor.
 * @param {string} nombre - Nombre a validar.
 * @param {number|null} excludeId - Id a excluir (edición).
 * @returns {Promise<void>}
 * @throws {Error} 400 si existe viva; 409 EXISTE_ELIMINADO si hay una eliminada.
 */
const checkListaUnica = async (models, espacioId, nombre, excludeId = null) => {
    const { Lista } = models;
    const idClause = excludeId ? { id: { [Op.ne]: excludeId } } : {};
    const vivo = await Lista.findOne({ where: { espacioId, nombre, ...idClause } });
    if (vivo) throw bizError(400, 'Ya existe una lista con ese nombre en este espacio');
    const eliminada = await Lista.findOne({ where: { espacioId, nombre, ...idClause }, paranoid: false });
    if (eliminada && eliminada.deletedAt) {
        throw bizError(409, `Ya existió una lista llamada «${nombre}» en este espacio (eliminada). Podés reactivarla.`, {
            errorCode: 'EXISTE_ELIMINADO',
            deletedId: eliminada.id
        });
    }
};

/**
 * Listas de un espacio con agregados (pendientes, vencidas, total, próximo vencimiento)
 * en una sola query extra. Incluye inactivas (se muestran atenuadas — regla del legado).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request (capa espacio: ver).
 * @param {number} espacioId - Espacio.
 * @returns {Promise<object>} { espacio, puedeEditar, listas }.
 */
export const listListas = async (models, user, espacioId) => {
    const { Lista, Tarea } = models;
    const espacio = await buscarEspacio(models, espacioId);
    const permisos = await exigirEspacioVer(models, user, espacioId);

    const listas = await Lista.findAll({ where: { espacioId }, order: [['nombre', 'ASC']] });
    const dias = await getDiasPorVencer(models);
    const cat = sqlCategorias(dias);

    const agg = listas.length ? await Tarea.findAll({
        where: { listaId: { [Op.in]: listas.map(l => l.id) } },
        attributes: [
            'listaId',
            [Tarea.sequelize.fn('COUNT', Tarea.sequelize.col('id')), 'total'],
            [Tarea.sequelize.literal(`COALESCE(SUM(${cat.pendientes}), 0)`), 'pendientes'],
            [Tarea.sequelize.literal(`COALESCE(SUM(${cat.vencidas}), 0)`), 'vencidas'],
            [Tarea.sequelize.literal(`MIN(CASE WHEN ${cat.pendientes} THEN \`tareas\`.\`fechaVencimiento\` END)`), 'proximoVencimiento']
        ],
        group: ['listaId'],
        raw: true
    }) : [];
    const porLista = Object.fromEntries(agg.map(r => [r.listaId, r]));

    return {
        espacio: { id: espacio.id, nombre: espacio.nombre, descripcion: espacio.descripcion, activo: espacio.activo },
        puedeEditar: !!permisos[Number(espacioId)]?.editar,
        listas: listas.map(l => ({
            ...l.toJSON(),
            total: Number(porLista[l.id]?.total) || 0,
            pendientes: Number(porLista[l.id]?.pendientes) || 0,
            vencidas: Number(porLista[l.id]?.vencidas) || 0,
            proximoVencimiento: porLista[l.id]?.proximoVencimiento || null
        }))
    };
};

/**
 * Crea una lista en un espacio (capa espacio: editar).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} espacioId - Espacio contenedor.
 * @param {object} data - { nombre, descripcion? }.
 * @returns {Promise<object>} La lista creada.
 */
export const createLista = async (models, user, espacioId, data) => {
    await buscarEspacio(models, espacioId);
    await exigirEspacioEditar(models, user, espacioId);
    await checkListaUnica(models, espacioId, data.nombre);
    return models.Lista.create({ ...data, espacioId, descripcion: data.descripcion || null });
};

/**
 * Edita una lista (nombre/descripcion). El WHERE incluye espacioId (no se editan ajenas).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} espacioId - Espacio contenedor.
 * @param {number} listaId - Lista a editar.
 * @param {object} data - Campos.
 * @returns {Promise<object|null>} La lista o null si no existe en el espacio.
 */
export const updateLista = async (models, user, espacioId, listaId, data) => {
    await buscarEspacio(models, espacioId);
    await exigirEspacioEditar(models, user, espacioId);
    const lista = await models.Lista.findOne({ where: { id: listaId, espacioId } });
    if (!lista) return null;
    if (data.nombre && data.nombre !== lista.nombre) {
        await checkListaUnica(models, espacioId, data.nombre, lista.id);
    }
    await lista.update({ ...data, descripcion: data.descripcion || null });
    return lista;
};

/**
 * Alterna `activa` de una lista.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} espacioId - Espacio contenedor.
 * @param {number} listaId - Lista.
 * @returns {Promise<object|null>} La lista o null.
 */
export const toggleLista = async (models, user, espacioId, listaId) => {
    await exigirEspacioEditar(models, user, espacioId);
    const lista = await models.Lista.findOne({ where: { id: listaId, espacioId } });
    if (!lista) return null;
    await lista.update({ activa: !lista.activa });
    return lista;
};

/**
 * Reactiva una lista eliminada.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} espacioId - Espacio contenedor.
 * @param {number} listaId - Lista eliminada.
 * @returns {Promise<object|null>} La lista restaurada o null.
 */
export const restoreLista = async (models, user, espacioId, listaId) => {
    await exigirEspacioEditar(models, user, espacioId);
    const lista = await models.Lista.findOne({ where: { id: listaId, espacioId }, paranoid: false });
    if (!lista || !lista.deletedAt) return null;
    const viva = await models.Lista.findOne({ where: { espacioId, nombre: lista.nombre } });
    if (viva) throw bizError(400, 'Ya existe una lista activa con ese nombre; renombrala primero');
    await lista.restore();
    return lista;
};

/**
 * Elimina (soft) una lista. Protección del legado: con tareas no se elimina.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} espacioId - Espacio contenedor.
 * @param {number} listaId - Lista.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 409 si tiene tareas.
 */
export const deleteLista = async (models, user, espacioId, listaId) => {
    await exigirEspacioEditar(models, user, espacioId);
    const lista = await models.Lista.findOne({ where: { id: listaId, espacioId } });
    if (!lista) return false;
    const n = await models.Tarea.count({ where: { listaId } });
    if (n > 0) throw bizError(409, `No se puede eliminar: la lista tiene ${n} tarea(s). Eliminalas primero.`);
    await lista.destroy();
    return true;
};

// ─────────────────────────── Tareas ───────────────────────────

/** Includes estándar de una tarea (asignado/creador con lo mínimo). */
const tareaIncludes = (models) => [
    { model: models.User, as: 'asignado', attributes: ['id', 'name', 'lastName'], required: false, paranoid: false },
    { model: models.User, as: 'creador', attributes: ['id', 'name', 'lastName'], required: false, paranoid: false }
];

/**
 * Escapa un término para LIKE (comodines del usuario son literales — «50%» busca 50%).
 * @param {string} texto - Término crudo.
 * @returns {string} Término escapado para LIKE (escape por backslash de MySQL).
 */
const likeEscape = (texto) => String(texto).replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Listado central de tareas de una lista con los 14 filtros del legado (§2.4/§2.5).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request (capa espacio: ver).
 * @param {number} espacioId - Espacio (de la URL).
 * @param {number} listaId - Lista (validada contra el espacio).
 * @param {object} q - Filtros por query string.
 * @returns {Promise<object>} { espacio, lista, puedeEditar, tareas, total }.
 */
export const listTareas = async (models, user, espacioId, listaId, q = {}) => {
    const { Tarea, Lista } = models;
    const espacio = await buscarEspacio(models, espacioId);
    const permisos = await exigirEspacioVer(models, user, espacioId);
    const lista = await Lista.findOne({ where: { id: listaId, espacioId } });
    if (!lista) throw bizError(404, 'Lista no encontrada en este espacio');

    const where = { espacioId: Number(espacioId), listaId: Number(listaId) };
    const and = [];

    // 1. estado[]: si viene no vacío manda (ignora incluirCompletadas — regla del legado).
    const estados = String(q.estado || '').split(',').filter(e => ESTADOS_TAREA.includes(e));
    if (estados.length) where.estado = { [Op.in]: estados };
    else if (String(q.incluirCompletadas) !== 'true') where.estado = { [Op.in]: ESTADOS_PENDIENTES };

    // 2. prioridad[].
    const prioridades = String(q.prioridad || '').split(',').filter(p => PRIORIDADES_TAREA.includes(p));
    if (prioridades.length) where.prioridad = { [Op.in]: prioridades };

    // 3. texto: nombre + descripción (busca dentro del HTML, falsos positivos asumidos).
    if (q.texto) {
        const term = `%${likeEscape(String(q.texto).slice(0, 100))}%`;
        and.push({ [Op.or]: [{ nombre: { [Op.like]: term } }, { descripcion: { [Op.like]: term } }] });
    }

    // 4. asignado (-1 = sin asignar) y creador.
    const asignadoA = parseInt(q.asignadoA, 10);
    if (asignadoA === -1) where.asignadoA = null;
    else if (asignadoA > 0) where.asignadoA = asignadoA;
    const creadoPor = parseInt(q.creadoPor, 10);
    if (creadoPor > 0) where.creadoPor = creadoPor;

    // 5. Rangos: vencimiento/inicio (DATEONLY) y creada (TIMESTAMP con sufijos de hora — §5.21).
    const rango = (campo, desde, hasta, conHora = false) => {
        const r = {};
        if (desde) r[Op.gte] = conHora ? `${desde} 00:00:00` : desde;
        if (hasta) r[Op.lte] = conHora ? `${hasta} 23:59:59` : hasta;
        if (Object.getOwnPropertySymbols(r).length) and.push({ [campo]: r });
    };
    rango('fechaVencimiento', q.vencDesde, q.vencHasta);
    rango('fechaInicio', q.inicioDesde, q.inicioHasta);
    rango('createdAt', q.creadaDesde, q.creadaHasta, true);

    // 6/7. Flags (soloVencidas + sinVencimiento juntos = vacío; el AND se respeta como el legado).
    if (String(q.soloVencidas) === 'true') {
        and.push({ fechaVencimiento: { [Op.lt]: Tarea.sequelize.literal('CURDATE()') } });
        and.push({ estado: { [Op.in]: ESTADOS_PENDIENTES } });
    }
    if (String(q.sinVencimiento) === 'true') and.push({ fechaVencimiento: null });
    if (String(q.conDescripcion) === 'true') and.push({ descripcion: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } });

    if (and.length) where[Op.and] = and;

    const tareas = await Tarea.findAll({
        where,
        include: tareaIncludes(models),
        order: [
            // Orden del legado, tal cual (§2.4).
            [Tarea.sequelize.literal(`\`tareas\`.\`estado\` = 'completada'`), 'ASC'],
            [Tarea.sequelize.literal(`FIELD(\`tareas\`.\`prioridad\`, 'rojo', 'naranja', 'amarillo', 'verde')`), 'ASC'],
            [Tarea.sequelize.literal('`tareas`.`fechaVencimiento` IS NULL'), 'ASC'],
            ['fechaVencimiento', 'ASC'],
            ['createdAt', 'DESC']
        ]
    });

    return {
        espacio: { id: espacio.id, nombre: espacio.nombre },
        lista: { id: lista.id, nombre: lista.nombre, descripcion: lista.descripcion, activa: lista.activa },
        puedeEditar: !!permisos[Number(espacioId)]?.editar,
        // La descripción no viaja en el listado (pesa); solo un flag de que existe.
        tareas: tareas.map(t => {
            const json = t.toJSON();
            const tieneDescripcion = !!(json.descripcion && String(json.descripcion).trim());
            delete json.descripcion;
            return { ...json, tieneDescripcion };
        }),
        total: tareas.length
    };
};

/**
 * Tiempo de trabajo de una tarea: suma de tramos en_progreso del historial (las pausas no
 * cuentan); un tramo abierto suma hasta ahora (§2.9).
 * @param {object[]} historialAsc - Eventos ASC ({ campo, valorNuevo, createdAt }). Los que no
 *   son cambios de estado se ignoran: la bitácora ahora registra todos los campos.
 * @returns {number} Segundos trabajados.
 */
export const tiempoTrabajado = (historialAsc) => {
    let acum = 0;
    let abierto = null;
    for (const ev of historialAsc.filter(e => !e.campo || e.campo === 'estado')) {
        const t = new Date(ev.createdAt).getTime();
        if (ev.valorNuevo === 'en_progreso') {
            if (abierto === null) abierto = t; // dos "en progreso" seguidos no reinician
        } else if (abierto !== null) {
            acum += Math.max(0, t - abierto); // max(0) contra desorden
            abierto = null;
        }
    }
    if (abierto !== null) acum += Math.max(0, Date.now() - abierto);
    return Math.round(acum / 1000);
};

/**
 * Detalle de una tarea + historial + tiempo trabajado + adjuntos. El acceso se controla
 * por EL ESPACIO DE LA TAREA (no por la URL). La descripción se RE-SANEA al servir.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Tarea.
 * @returns {Promise<object|null>} Detalle o null si no existe.
 */
export const getTarea = async (models, user, id) => {
    const { Tarea, TareaCambio, TareaArchivo, Lista, User } = models;
    const tarea = await Tarea.findByPk(id, {
        include: [
            ...tareaIncludes(models),
            { model: Lista, attributes: ['id', 'nombre'], paranoid: false }
        ]
    });
    if (!tarea) return null;
    await exigirEspacioVer(models, user, tarea.espacioId);

    const [historial, archivos, comentarios] = await Promise.all([
        TareaCambio.findAll({
            where: { tareaId: id },
            include: [{ model: User, attributes: ['id', 'name', 'lastName'], required: false, paranoid: false }],
            order: [['createdAt', 'ASC'], ['id', 'ASC']]
        }),
        TareaArchivo.findAll({ where: { tareaId: id, tipo: 'archivo' }, order: [['createdAt', 'ASC']] }),
        models.TareaComentario
            ? models.TareaComentario.findAll({
                where: { tareaId: id },
                include: [{ model: User, attributes: ['id', 'name', 'lastName'], required: false, paranoid: false }],
                order: [['createdAt', 'ASC'], ['id', 'ASC']]
            })
            : []
    ]);

    const json = tarea.toJSON();
    json.descripcion = sanearHtml(json.descripcion); // sanear al servir, siempre

    return {
        ...json,
        tiempoTrabajado: tiempoTrabajado(historial.map(h => h.toJSON())),
        historial: [...historial].reverse().map(h => ({
            id: h.id,
            campo: h.campo,
            campoLabel: CAMPOS_AUDITADOS[h.campo] ?? h.campo,
            valorAnterior: h.valorAnterior,
            valorNuevo: h.valorNuevo,
            // Usuario borrado → null (el frontend muestra "usuario dado de baja").
            usuario: h.user ? `${h.user.name} ${h.user.lastName}`.trim() : null,
            fecha: h.createdAt
        })),
        archivos: archivos.map(a => ({ ...a.toJSON(), url: `/api/tareas/archivos/${a.nombre}` })),
        comentarios: comentarios.map(c => ({
            id: c.id,
            texto: c.texto,
            userId: c.userId,
            usuario: c.user ? `${c.user.name} ${c.user.lastName}`.trim() : 'usuario dado de baja',
            fecha: c.createdAt
        }))
    };
};

/**
 * Notifica sin romper la mutación que la origina (best-effort).
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO o null.
 * @param {object} data - Payload de crearNotificacion.
 * @returns {Promise<void>}
 */
const notificar = async (models, io, data) => { await crearNotificacion(models, io, data); };

/** URL interna del listado de la tarea (para el "ir a" de la notificación). */
const urlDeTarea = (tarea) => `/tareas/espacios/${tarea.espacioId}/listas/${tarea.listaId}`;

/**
 * Validaciones comunes de guardado (mensajes del legado, acumulativas en el validator;
 * acá las de negocio).
 * @param {object} models - Modelos de la app.
 * @param {object} data - { asignadoA?, fechaInicio?, fechaVencimiento? }.
 * @returns {Promise<void>}
 * @throws {Error} 400 con el mensaje correspondiente.
 */
const validarNegocio = async (models, data) => {
    if (data.asignadoA) await validarAsignable(models, data.asignadoA);
    if (data.fechaVencimiento && data.fechaInicio && data.fechaVencimiento < data.fechaInicio) {
        throw bizError(400, 'El vencimiento no puede ser anterior a la fecha de inicio');
    }
};

/**
 * Registra un cambio de estado en la bitácora (no anota si no cambió — §5.15).
 * @param {object} models - Modelos de la app.
 * @param {number} tareaId - Tarea.
 * @param {string|null} anterior - Estado anterior (null = creación).
 * @param {string} nuevo - Estado nuevo.
 * @param {number} userId - Quién.
 * @param {object} [opts] - { transaction }.
 * @returns {Promise<boolean>} true si anotó.
 */
const registrarEstado = async (models, tareaId, anterior, nuevo, userId, opts = {}) => {
    if (anterior !== null && anterior === nuevo) return false;
    await models.TareaCambio.create({ tareaId, campo: 'estado', valorAnterior: anterior, valorNuevo: nuevo, userId }, opts);
    return true;
};

/** Campos que se auditan, con su etiqueta para mostrar. */
export const CAMPOS_AUDITADOS = {
    nombre: 'Nombre',
    estado: 'Estado',
    asignadoA: 'Asignada a',
    prioridad: 'Prioridad',
    fechaInicio: 'Fecha de inicio',
    fechaVencimiento: 'Vencimiento',
    descripcion: 'Descripción',
    listaId: 'Lista',
};

/**
 * Normaliza un valor para compararlo y guardarlo en la bitácora.
 * Sin esto, `null` vs `''` vs `undefined` se registrarían como cambios que no existieron.
 * @param {*} v - Valor crudo.
 * @returns {string|null} Texto comparable, o null si está vacío.
 */
const paraBitacora = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
};

/**
 * Compara el antes y el después de una tarea y anota UNA fila por campo que cambió.
 *
 * Una fila por campo y no una por edición: así el historial dice «cambió la prioridad de
 * verde a rojo», que es lo que sirve para reconstruir qué pasó.
 *
 * La descripción se registra como «se modificó» sin volcar el HTML entero: guardar dos copias
 * del cuerpo en cada edición haría crecer la bitácora sin que nadie lea ese diff.
 * @param {object} models - Modelos de la app.
 * @param {number} tareaId - Tarea.
 * @param {object} antes - Valores previos (por nombre de campo).
 * @param {object} despues - Valores nuevos (por nombre de campo).
 * @param {number} userId - Quién edita.
 * @param {object} [opts] - { transaction }.
 * @returns {Promise<number>} Cuántos cambios se anotaron.
 */
const registrarCambios = async (models, tareaId, antes, despues, userId, opts = {}) => {
    const filas = [];
    for (const campo of Object.keys(CAMPOS_AUDITADOS)) {
        if (!(campo in despues)) continue;   // no se tocó en esta edición
        const a = paraBitacora(antes[campo]);
        const b = paraBitacora(despues[campo]);
        if (a === b) continue;

        filas.push({
            tareaId, campo, userId,
            valorAnterior: campo === 'descripcion' ? (a ? '(texto anterior)' : null) : a,
            valorNuevo: campo === 'descripcion' ? (b ? '(texto nuevo)' : null) : b,
        });
    }
    if (filas.length) await models.TareaCambio.bulkCreate(filas, opts);
    return filas.length;
};

/**
 * Crea una tarea (capa espacio: editar sobre el espacio de la lista).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {object} data - { listaId, nombre, asignadoA?, prioridad?, estado?, fechaInicio?,
 *   fechaVencimiento?, descripcion?, archivoIds? }. `archivoIds` son adjuntos ya subidos
 *   (todavía sin tarea) que el alta liga a la tarea recién creada: permite adjuntar durante
 *   la creación, cuando el id de la tarea todavía no existe.
 * @returns {Promise<object>} La tarea creada.
 */
export const createTarea = async (models, user, data, io = null) => {
    const { Tarea, Lista } = models;
    const lista = await Lista.findByPk(data.listaId);
    if (!lista) throw bizError(404, 'Lista no encontrada');
    await exigirEspacioEditar(models, user, lista.espacioId);
    await validarNegocio(models, data);
    await exigirPoderAsignar(models, user, data.asignadoA || null);

    const descripcion = sanearHtml(data.descripcion) || null;
    const tarea = await Tarea.sequelize.transaction(async (t) => {
        const nueva = await Tarea.create({
            espacioId: lista.espacioId,
            listaId: lista.id,
            nombre: data.nombre,
            descripcion,
            asignadoA: data.asignadoA || null,
            creadoPor: user.id,
            prioridad: data.prioridad || 'verde',
            estado: data.estado || 'abierta',
            fechaInicio: data.fechaInicio || null,
            fechaVencimiento: data.fechaVencimiento || null
        }, { transaction: t });
        await registrarEstado(models, nueva.id, null, nueva.estado, user.id, { transaction: t });
        return nueva;
    });
    await ligarImagenes(models, tarea.id, descripcion);
    // Adjuntos subidos ANTES de existir la tarea: se ligan ahora (solo los que siguen
    // huérfanos, para que nadie pueda robarse el adjunto de otra tarea pasando su id).
    const archivoIds = (data.archivoIds || []).map(Number).filter(Boolean);
    if (archivoIds.length) {
        await models.TareaArchivo.update(
            { tareaId: tarea.id },
            { where: { id: archivoIds, tareaId: null } }
        );
    }
    if (tarea.asignadoA && tarea.asignadoA !== user.id) {
        await notificar(models, io, {
            userId: tarea.asignadoA, tipo: 'tarea-asignada',
            titulo: 'Te asignaron una tarea',
            cuerpo: tarea.nombre, url: urlDeTarea(tarea)
        });
    }
    return getTarea(models, user, tarea.id);
};

/**
 * Crea la MISMA tarea en varias listas: una tarea independiente por lista.
 *
 * Cada tarea sigue perteneciendo a UNA sola lista (el modelo no cambia): esto es un atajo de
 * carga, no una tarea compartida. Se copia todo —descripción y una copia propia de cada
 * adjunto— así cada una vive por su cuenta y borrar una no afecta a las demás.
 *
 * Los permisos se validan lista por lista dentro de `createTarea`: si el usuario no puede
 * editar el espacio de una de ellas, esa falla y las demás se crean igual. Se devuelve el
 * detalle de lo que salió bien y el motivo de lo que no, en vez de abortar todo por una.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {object} data - Igual que `createTarea`, pero con `listaIds` (array).
 * @param {object|null} [io] - Socket.IO.
 * @returns {Promise<{creadas: object[], errores: Array<{listaId: number, motivo: string}>}>}
 */
export const createTareaEnListas = async (models, user, data, io = null) => {
    const ids = [...new Set((data.listaIds || []).map(Number).filter(Boolean))];
    if (!ids.length) throw bizError(400, 'Elegí al menos una lista');

    const creadas = [];
    const errores = [];
    // Los adjuntos subidos sueltos se ligan a la PRIMERA tarea; para el resto se duplican,
    // porque un registro de adjunto pertenece a una sola tarea.
    const archivoIds = (data.archivoIds || []).map(Number).filter(Boolean);
    let primera = true;

    for (const listaId of ids) {
        try {
            const tarea = await createTarea(
                models, user,
                { ...data, listaId, archivoIds: primera ? archivoIds : [] },
                io,
            );
            // De la segunda en adelante: copia propia de cada adjunto.
            if (!primera && archivoIds.length) {
                const { duplicarArchivo } = await import('./archivo.service.js');
                for (const aid of archivoIds) await duplicarArchivo(models, aid, tarea.id);
            }
            creadas.push(tarea);
            primera = false;
        } catch (e) {
            errores.push({ listaId, motivo: e.message });
        }
    }
    if (!creadas.length) throw bizError(400, errores[0]?.motivo || 'No se pudo crear la tarea');
    return { creadas, errores };
};

/* ─────────────────────────────── Clonar ─────────────────────────────── */

/**
 * Nombre libre para una copia: «X (copia)», y si ya existe «X (copia 2)», «X (copia 3)»…
 *
 * Se numera en vez de fallar con un 409 porque clonar dos veces la misma cosa es normal
 * («armo tres proyectos iguales a partir de este») y hacer que el usuario invente el nombre
 * cada vez convierte un clic en un formulario.
 * @param {string} base - Nombre del original.
 * @param {Set<string>} ocupados - Nombres que ya están en uso (en minúsculas).
 * @param {number} maxLargo - Largo máximo de la columna (tarea 200, lista 100).
 * @returns {string} Un nombre libre.
 */
export const nombreDeCopia = (base, ocupados, maxLargo) => {
    /**
     * Recorta el nombre para que el sufijo entre dentro del largo de la columna.
     * @param {string} sufijo - Sufijo a agregar.
     * @returns {string} Nombre completo, recortado si hacía falta.
     */
    const armar = (sufijo) => {
        const tope = maxLargo - sufijo.length;
        return `${base.length > tope ? base.slice(0, tope).trimEnd() : base}${sufijo}`;
    };
    let candidato = armar(' (copia)');
    let n = 2;
    while (ocupados.has(candidato.toLowerCase())) {
        candidato = armar(` (copia ${n})`);
        n += 1;
    }
    return candidato;
};

/**
 * Copia los adjuntos de una tarea a otra (cada copia con su propio archivo en disco).
 * @param {object} models - Modelos de la app.
 * @param {number} origenId - Tarea de origen.
 * @param {number} destinoId - Tarea de destino.
 * @returns {Promise<number>} Cuántos se copiaron.
 */
const copiarAdjuntos = async (models, origenId, destinoId) => {
    const { duplicarArchivo } = await import('./archivo.service.js');
    const archivos = await models.TareaArchivo.findAll({ where: { tareaId: origenId }, attributes: ['id'], raw: true });
    let copiados = 0;
    for (const a of archivos) {
        // Si un binario se perdió del disco, `duplicarArchivo` devuelve null: se saltea en vez
        // de abortar el clon entero por un adjunto que ya no está.
        if (await duplicarArchivo(models, a.id, destinoId)) copiados += 1;
    }
    return copiados;
};

/**
 * Clona una tarea: una tarea nueva e independiente con los mismos datos.
 *
 * Qué se copia y qué no, y por qué:
 *  - **Sí**: nombre (con sufijo de copia), descripción, prioridad, fechas, asignado y una
 *    **copia propia** de cada adjunto — así borrar una no toca a la otra.
 *  - **No**: el estado, que arranca en `abierta`. Clonar una tarea completada es justamente
 *    para volver a hacerla; heredar «completada» dejaría el clon terminado antes de empezar.
 *  - **No**: el historial ni los comentarios. Son de lo que pasó en la tarea original; el clon
 *    arranca con su propia entrada de creación.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Tarea a clonar.
 * @param {object} [opts] - Opciones.
 * @param {number} [opts.listaId] - Lista destino (default: la misma).
 * @param {string} [opts.nombre] - Nombre del clon (default: «… (copia)»).
 * @param {boolean} [opts.conservarNombre] - Deja el nombre TAL CUAL, sin sufijo de copia (lo
 *   usa el clon de una lista completa: dentro de una lista nueva no hay con qué chocar).
 * @param {object|null} [io] - Socket.IO.
 * @returns {Promise<object>} El detalle de la tarea nueva.
 */
export const clonarTarea = async (models, user, id, opts = {}, io = null) => {
    const { Tarea, Lista } = models;
    const orig = await Tarea.findByPk(id);
    if (!orig) throw bizError(404, 'Tarea no encontrada');
    // Se exige editar el espacio del ORIGEN (para leerlo) y el del DESTINO (para escribir):
    // clonar de un espacio al que entro hacia uno donde no puedo escribir no es válido.
    await exigirEspacioEditar(models, user, orig.espacioId);

    const destino = opts.listaId ? await Lista.findByPk(opts.listaId) : await Lista.findByPk(orig.listaId);
    if (!destino) throw bizError(404, 'Lista destino no encontrada');
    if (destino.espacioId !== orig.espacioId) await exigirEspacioEditar(models, user, destino.espacioId);

    let nombre = opts.nombre?.trim();
    if (!nombre && opts.conservarNombre) nombre = orig.nombre;
    if (!nombre) {
        // Solo se consultan los nombres de la lista destino: las tareas no tienen unicidad,
        // pero repetir el nombre exacto en la misma lista deja dos filas indistinguibles.
        const hermanas = await Tarea.findAll({ where: { listaId: destino.id }, attributes: ['nombre'], raw: true });
        nombre = nombreDeCopia(orig.nombre, new Set(hermanas.map(h => h.nombre.toLowerCase())), 200);
    }

    const clon = await Tarea.sequelize.transaction(async (tx) => {
        const nueva = await Tarea.create({
            espacioId: destino.espacioId,
            listaId: destino.id,
            nombre,
            // La descripción ya está saneada en el original: se copia tal cual.
            descripcion: orig.descripcion,
            asignadoA: orig.asignadoA,
            creadoPor: user.id,
            prioridad: orig.prioridad,
            estado: 'abierta',
            fechaInicio: orig.fechaInicio,
            fechaVencimiento: orig.fechaVencimiento,
        }, { transaction: tx });
        await registrarEstado(models, nueva.id, null, 'abierta', user.id, { transaction: tx });
        return nueva;
    });

    // Las imágenes del cuerpo se ligan igual que en un alta: el HTML apunta a los archivos del
    // original, así que se duplican para que borrar el original no vacíe el clon.
    await copiarAdjuntos(models, orig.id, clon.id);

    if (clon.asignadoA && clon.asignadoA !== user.id) {
        await notificar(models, io, {
            userId: clon.asignadoA, tipo: 'tarea-asignada',
            titulo: 'Te asignaron una tarea',
            cuerpo: clon.nombre, url: urlDeTarea(clon),
        });
    }
    return getTarea(models, user, clon.id);
};

/**
 * Clona una lista **con todas sus tareas**.
 *
 * Es la operación «usar esto como plantilla»: sirve para repetir un checklist en un proyecto
 * nuevo. Por eso las tareas clonadas arrancan todas en `abierta` — una plantilla con la mitad
 * de los ítems ya completados no sirve de plantilla.
 *
 * Las tareas ELIMINADAS de la lista original no se clonan (el `findAll` es paranoid): estaban
 * borradas, y resucitarlas en la copia sería una sorpresa.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} espacioId - Espacio contenedor.
 * @param {number} listaId - Lista a clonar.
 * @param {object} [data] - Opciones.
 * @param {string} [data.nombre] - Nombre de la copia (default: «… (copia)»).
 * @param {boolean} [data.conTareas] - Si clona las tareas (default true).
 * @returns {Promise<{lista: object, tareas: number, errores: Array<{tareaId: number, motivo: string}>}>}
 */
export const clonarLista = async (models, user, espacioId, listaId, data = {}) => {
    const { Lista, Tarea } = models;
    await buscarEspacio(models, espacioId);
    await exigirEspacioEditar(models, user, espacioId);

    const orig = await Lista.findOne({ where: { id: listaId, espacioId } });
    if (!orig) return null;

    let nombre = data.nombre?.trim();
    if (nombre) {
        // Nombre elegido a mano: se valida como en un alta normal (incluido el 409 de
        // «existió y está eliminada», que ofrece reactivar en vez de bloquear sin salida).
        await checkListaUnica(models, espacioId, nombre);
    } else {
        // Automático: se miran también las ELIMINADAS, porque `checkListaUnica` rechaza
        // chocar con una de esas y el numerado tiene que saltearlas para no elegir un nombre
        // que después va a fallar.
        const todas = await Lista.findAll({ where: { espacioId }, attributes: ['nombre'], paranoid: false, raw: true });
        nombre = nombreDeCopia(orig.nombre, new Set(todas.map(l => l.nombre.toLowerCase())), 100);
    }

    const copia = await Lista.create({
        espacioId,
        nombre,
        descripcion: orig.descripcion,
        activa: orig.activa,
    });

    if (data.conTareas === false) return { lista: copia, tareas: 0, errores: [] };

    // Se clonan en el orden original para que la lista nueva se lea igual que la vieja.
    const tareas = await Tarea.findAll({ where: { listaId: orig.id }, order: [['id', 'ASC']], attributes: ['id'], raw: true });
    const errores = [];
    let clonadas = 0;
    for (const tarea of tareas) {
        try {
            // La lista destino está recién creada y vacía, así que no hay con qué chocar: las
            // tareas conservan su nombre. Ponerle «(copia)» a 40 tareas sería ruido.
            await clonarTarea(models, user, tarea.id, { listaId: copia.id, conservarNombre: true });
            clonadas += 1;
        } catch (e) {
            // Una tarea que falla no aborta el resto: se informa y se sigue.
            errores.push({ tareaId: tarea.id, motivo: e.message });
        }
    }
    return { lista: copia, tareas: clonadas, errores };
};

/**
 * Edición COMPLETA (modal completo): todos los campos menos la lista (mover es otra acción).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Tarea.
 * @param {object} data - Campos completos.
 * @returns {Promise<object|null>} El detalle actualizado o null si no existe.
 */
export const updateTareaCompleta = async (models, user, id, data, io = null) => {
    const { Tarea } = models;
    const tarea = await Tarea.findByPk(id);
    if (!tarea) return null;
    await exigirEspacioEditar(models, user, tarea.espacioId);
    await validarNegocio(models, data);
    await exigirPoderAsignar(models, user, data.asignadoA || null, tarea.asignadoA);

    const asignadoPrevio = tarea.asignadoA;
    const descripcion = sanearHtml(data.descripcion) || null;
    // Foto del antes: hay que tomarla ANTES del update, si no se compara contra sí mismo.
    const antes = {
        nombre: tarea.nombre, estado: tarea.estado, asignadoA: tarea.asignadoA,
        prioridad: tarea.prioridad, fechaInicio: tarea.fechaInicio,
        fechaVencimiento: tarea.fechaVencimiento, descripcion: tarea.descripcion,
    };
    const despues = {
        nombre: data.nombre,
        descripcion,
        asignadoA: data.asignadoA || null,
        prioridad: data.prioridad || 'verde',
        estado: data.estado || 'abierta',
        fechaInicio: data.fechaInicio || null,
        fechaVencimiento: data.fechaVencimiento || null,
    };
    await Tarea.sequelize.transaction(async (t) => {
        await tarea.update(despues, { transaction: t });
        // Una sola llamada: registra el estado Y todo lo demás que haya cambiado.
        await registrarCambios(models, tarea.id, antes, despues, user.id, { transaction: t });
    });
    await ligarImagenes(models, tarea.id, descripcion);
    if (tarea.asignadoA && tarea.asignadoA !== asignadoPrevio && tarea.asignadoA !== user.id) {
        await notificar(models, io, {
            userId: tarea.asignadoA, tipo: 'tarea-asignada',
            titulo: 'Te asignaron una tarea',
            cuerpo: tarea.nombre, url: urlDeTarea(tarea)
        });
    }
    return getTarea(models, user, id);
};

/**
 * Edición RÁPIDA (modal rápido): SOLO nombre, asignado, vencimiento y prioridad.
 * NO toca descripción ni estado (§5.12 — un PUT completo desde acá borraría descripciones).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Tarea.
 * @param {object} data - { nombre, asignadoA?, fechaVencimiento?, prioridad }.
 * @returns {Promise<object|null>} La tarea actualizada o null.
 */
export const updateTareaRapida = async (models, user, id, data, io = null) => {
    const { Tarea } = models;
    const tarea = await Tarea.findByPk(id);
    if (!tarea) return null;
    await exigirEspacioEditar(models, user, tarea.espacioId);
    await validarNegocio(models, { ...data, fechaInicio: tarea.fechaInicio });

    // PATCH real: solo se tocan los campos PRESENTES (ausente ≠ borrar).
    const patch = { nombre: data.nombre };
    if ('asignadoA' in data) patch.asignadoA = data.asignadoA || null;
    if ('fechaVencimiento' in data) patch.fechaVencimiento = data.fechaVencimiento || null;
    if ('prioridad' in data) patch.prioridad = data.prioridad;
    await exigirPoderAsignar(models, user, patch.asignadoA ?? null, tarea.asignadoA);

    const asignadoPrevio = tarea.asignadoA;
    const antes = {
        nombre: tarea.nombre, asignadoA: tarea.asignadoA,
        prioridad: tarea.prioridad, fechaVencimiento: tarea.fechaVencimiento,
    };
    await Tarea.sequelize.transaction(async (t) => {
        await tarea.update(patch, { transaction: t });
        // La edición rápida NO registraba nada: cambiar el asignado o la fecha desde el
        // listado no dejaba rastro. `patch` solo trae los campos presentes, así que
        // `registrarCambios` audita exactamente lo que se tocó.
        await registrarCambios(models, tarea.id, antes, patch, user.id, { transaction: t });
    });
    if (tarea.asignadoA && tarea.asignadoA !== asignadoPrevio && tarea.asignadoA !== user.id) {
        await notificar(models, io, {
            userId: tarea.asignadoA, tipo: 'tarea-asignada',
            titulo: 'Te asignaron una tarea',
            cuerpo: tarea.nombre, url: urlDeTarea(tarea)
        });
    }
    return tarea;
};

/**
 * Cambio rápido de estado (+ bitácora). El estado inválido lo corta el validator con 422
 * (el legado lo normalizaba a 'abierta' y podía reabrir completadas — §5.13).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Tarea.
 * @param {string} estado - Estado nuevo (ya validado).
 * @returns {Promise<{tarea: object, cambio: boolean}|null>} Resultado o null si no existe.
 */
export const cambiarEstado = async (models, user, id, estado, io = null) => {
    const { Tarea } = models;
    const tarea = await Tarea.findByPk(id);
    if (!tarea) return null;
    await exigirEspacioEditar(models, user, tarea.espacioId);

    const anterior = tarea.estado;
    await Tarea.sequelize.transaction(async (t) => {
        await tarea.update({ estado }, { transaction: t });
        await registrarEstado(models, tarea.id, anterior, estado, user.id, { transaction: t });
    });
    if (anterior !== estado && tarea.asignadoA && tarea.asignadoA !== user.id) {
        await notificar(models, io, {
            userId: tarea.asignadoA, tipo: 'tarea-estado',
            titulo: `Tu tarea pasó a ${estado.replace('_', ' ')}`,
            cuerpo: tarea.nombre, url: urlDeTarea(tarea)
        });
    }
    return { tarea, cambio: anterior !== estado };
};

/**
 * MUEVE una tarea a otra lista (mejora §10.5 — el legado no lo permitía). Si la lista
 * destino es de OTRO espacio, exige editar en AMBOS espacios.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Tarea.
 * @param {number} listaDestinoId - Lista destino.
 * @returns {Promise<object|null>} La tarea movida o null si no existe.
 */
export const moverTarea = async (models, user, id, listaDestinoId) => {
    const { Tarea, Lista } = models;
    const tarea = await Tarea.findByPk(id);
    if (!tarea) return null;
    const destino = await Lista.findByPk(listaDestinoId);
    if (!destino) throw bizError(404, 'Lista destino no encontrada');

    await exigirEspacioEditar(models, user, tarea.espacioId);
    if (destino.espacioId !== tarea.espacioId) {
        await exigirEspacioEditar(models, user, destino.espacioId);
    }
    await tarea.update({ listaId: destino.id, espacioId: destino.espacioId });
    return tarea;
};

/**
 * Elimina (soft) una tarea. 404 real si no existe (el legado flasheaba éxito igual — §5.14).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {number} id - Tarea.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 */
export const deleteTarea = async (models, user, id) => {
    const tarea = await models.Tarea.findByPk(id);
    if (!tarea) return false;
    await exigirEspacioEditar(models, user, tarea.espacioId);
    await tarea.destroy();
    return true;
};

// ─────────────────────────── Resumen por categorías ───────────────────────────

/**
 * Resumen por categorías (§2.8): conteos de las 4 categorías + el listado de la elegida,
 * agrupado espacio → listas → tareas. La MISMA condición SQL alimenta número y listado.
 *
 * `u`: 'todos' = equipo; 'sin' = sin asignar; id numérico ≠ mío = ese usuario; cualquier
 * otra cosa (incluido mi id) = mías. Un parámetro mal escrito nunca amplía lo que se ve.
 * `e`: ids de espacio separados por coma (filtro MÚLTIPLE). Se INTERSECA con los visibles:
 * pedir un espacio ajeno no lo muestra, y si no queda ninguno válido se ignora el filtro
 * (mejor todo que una pantalla vacía sin explicación). El filtro entra también en los
 * CONTEOS: si no, la solapa diría 12 y la tabla mostraría 3.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @param {string} f - Categoría (basura → 'pendientes').
 * @param {string} u - Alcance (ver arriba).
 * @param {string} [e] - Ids de espacio separados por coma (vacío = todos los visibles).
 * @returns {Promise<object>} { categoria, alcance, dias, conteos, grupos, usuario, espacios, espaciosFiltro }.
 */
export const resumenCategorias = async (models, user, f, u, e) => {
    const { Tarea, EspacioTrabajo, Lista } = models;
    const dias = await getDiasPorVencer(models);
    const cat = sqlCategorias(dias);
    const categoria = cat[f] ? f : 'pendientes';

    // Alcance de asignación (regla del legado).
    let alcance = 'mias';
    let asignadoSql = `\`tareas\`.\`asignadoA\` = ${Number(user.id)}`;
    let usuarioNombre = null;
    if (u === 'todos') { alcance = 'todos'; asignadoSql = '1=1'; }
    else if (u === 'sin') { alcance = 'sin'; asignadoSql = '`tareas`.`asignadoA` IS NULL'; }
    else if (/^\d+$/.test(String(u)) && Number(u) !== user.id) {
        const otro = await models.User.findByPk(Number(u));
        if (!otro) throw bizError(404, 'Usuario no encontrado');
        alcance = 'usuario';
        usuarioNombre = `${otro.name} ${otro.lastName}`.trim();
        asignadoSql = `\`tareas\`.\`asignadoA\` = ${Number(u)}`;
    }

    // «Sin asignar» manda sobre el alcance: pedir las sin-dueño y que además sean «mías» no
    // devuelve nada nunca. Si se elige esa categoría, se ignora el filtro por persona.
    if (categoria === 'sin_asignar') { alcance = 'sin'; usuarioNombre = null; asignadoSql = '1=1'; }

    const permisos = await getEspacioPermisos(models, user);
    const visiblesIds = Object.entries(permisos).filter(([, p]) => p.ver).map(([id]) => Number(id));
    // Derivado de `cat` y no escrito a mano: al sumar una categoría no hay que acordarse de acá.
    const vacio = Object.fromEntries(Object.keys(cat).map(k => [k, 0]));
    if (!visiblesIds.length) {
        return {
            categoria, alcance, usuario: usuarioNombre, dias, conteos: vacio, grupos: [],
            espacios: [], espaciosFiltro: []
        };
    }

    // Catálogo para el selector del frontend: TODOS los visibles (no los filtrados), si no
    // el filtro se autodestruiría — al elegir uno desaparecerían los demás del selector.
    const espaciosVisibles = await EspacioTrabajo.findAll({
        where: { id: { [Op.in]: visiblesIds } },
        attributes: ['id', 'nombre', 'activo'],
        order: [['nombre', 'ASC']],
        raw: true
    });

    const pedidos = String(e ?? '').split(',').map(v => Number(String(v).trim())).filter(Number.isInteger);
    const espaciosFiltro = visiblesIds.filter(id => pedidos.includes(id));
    const alcanceEspacios = espaciosFiltro.length ? espaciosFiltro : visiblesIds;

    const espaciosSql = `\`tareas\`.\`espacioId\` IN (${alcanceEspacios.join(',')})`;

    // Conteos de las 4 categorías con las MISMAS condiciones del listado.
    const conteosRow = await Tarea.findOne({
        where: Tarea.sequelize.literal(`${espaciosSql} AND ${asignadoSql}`),
        attributes: Object.entries(cat).map(([key, cond]) => (
            [Tarea.sequelize.literal(`COALESCE(SUM(${cond}), 0)`), key]
        )),
        raw: true
    });
    const conteos = Object.fromEntries(Object.keys(cat).map(k => [k, Number(conteosRow?.[k]) || 0]));

    // Listado de la categoría elegida, agrupado espacio → lista.
    const tareas = await Tarea.findAll({
        where: Tarea.sequelize.literal(`${espaciosSql} AND ${asignadoSql} AND ${cat[categoria]}`),
        include: [
            ...tareaIncludes(models),
            { model: Lista, attributes: ['id', 'nombre'], paranoid: false },
            { model: EspacioTrabajo, attributes: ['id', 'nombre'], paranoid: false }
        ],
        order: [
            [EspacioTrabajo, 'nombre', 'ASC'],
            [Lista, 'nombre', 'ASC'],
            [Tarea.sequelize.literal('`tareas`.`fechaVencimiento` IS NULL'), 'ASC'],
            ['fechaVencimiento', 'ASC'],
            [Tarea.sequelize.literal(`FIELD(\`tareas\`.\`prioridad\`, 'rojo', 'naranja', 'amarillo', 'verde')`), 'ASC'],
            ['nombre', 'ASC']
        ]
    });

    // Agrupar por espacio → lista (client-friendly).
    const grupos = [];
    const porEspacio = new Map();
    for (const t of tareas) {
        const json = t.toJSON();
        const eid = json.espacios_trabajo?.id ?? json.espacioId;
        if (!porEspacio.has(eid)) {
            const g = { espacioId: eid, espacio: json.espacios_trabajo?.nombre ?? '', listas: [], _listas: new Map() };
            porEspacio.set(eid, g);
            grupos.push(g);
        }
        const g = porEspacio.get(eid);
        const lid = json.lista?.id ?? json.listaId;
        if (!g._listas.has(lid)) {
            const l = { listaId: lid, lista: json.lista?.nombre ?? '', tareas: [] };
            g._listas.set(lid, l);
            g.listas.push(l);
        }
        delete json.descripcion;
        g._listas.get(lid).tareas.push(json);
    }
    grupos.forEach(g => delete g._listas);

    return {
        categoria, alcance, usuario: usuarioNombre, dias, conteos, grupos,
        espacios: espaciosVisibles.map(x => ({ id: x.id, nombre: x.nombre, activo: !!x.activo })),
        espaciosFiltro
    };
};

// ─────────────────────────── Comentarios ───────────────────────────

/**
 * Agrega un comentario a una tarea (mejora §10.9). Comentar requiere VER el espacio
 * (colaboración, no edición). Notifica al asignado y a las menciones @username.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Autor.
 * @param {number} tareaId - Tarea.
 * @param {string} texto - Texto plano.
 * @param {object|null} [io] - Socket.IO para la entrega en vivo.
 * @returns {Promise<object>} El comentario creado (con autor).
 */
export const addComentario = async (models, user, tareaId, texto, io = null) => {
    const { Tarea, TareaComentario, User } = models;
    const tarea = await Tarea.findByPk(tareaId);
    if (!tarea) throw bizError(404, 'Tarea no encontrada');
    await exigirEspacioVer(models, user, tarea.espacioId);

    const comentario = await TareaComentario.create({ tareaId, userId: user.id, texto: texto.trim() });

    // Menciones @username → notificación a cada mencionado activo (excepto el autor).
    const notificados = new Set([user.id]);
    const menciones = [...texto.matchAll(/@([a-zA-Z0-9._-]+)/g)].map(m => m[1]);
    if (menciones.length) {
        const mencionados = await User.findAll({
            where: { username: { [Op.in]: menciones }, active: true },
            attributes: ['id']
        });
        for (const m of mencionados) {
            if (notificados.has(m.id)) continue;
            notificados.add(m.id);
            await notificar(models, io, {
                userId: m.id, tipo: 'tarea-comentario',
                titulo: 'Te mencionaron en un comentario',
                cuerpo: `${tarea.nombre}: ${texto.slice(0, 120)}`, url: urlDeTarea(tarea)
            });
        }
    }
    // El asignado también se entera (si no fue autor ni mencionado).
    if (tarea.asignadoA && !notificados.has(tarea.asignadoA)) {
        await notificar(models, io, {
            userId: tarea.asignadoA, tipo: 'tarea-comentario',
            titulo: 'Nuevo comentario en tu tarea',
            cuerpo: `${tarea.nombre}: ${texto.slice(0, 120)}`, url: urlDeTarea(tarea)
        });
    }

    return {
        id: comentario.id,
        tareaId,
        texto: comentario.texto,
        userId: user.id,
        usuario: `${user.name} ${user.lastName}`.trim(),
        fecha: comentario.createdAt
    };
};

/**
 * Elimina un comentario: el autor o un admin (`*`).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Quién pide.
 * @param {number} comentarioId - Comentario.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 * @throws {Error} 403 si no es el autor ni admin.
 */
export const deleteComentario = async (models, user, comentarioId) => {
    const comentario = await models.TareaComentario.findByPk(comentarioId);
    if (!comentario) return false;
    if (comentario.userId !== user.id && !(await rolPuede(models, user.roleId, '*'))) {
        throw bizError(403, 'Solo el autor puede eliminar su comentario');
    }
    await comentario.destroy();
    return true;
};

/**
 * Bloque "Tareas del equipo" para el Panel (../analisis_app_php/03 §4.9) — acotado a los
 * espacios VISIBLES del que mira (para que cada número coincida con el listado destino):
 *  a) 4 tarjetas del equipo (pendientes con hint en progreso/pausadas, hoy, por vencer,
 *     vencidas con "en N persona(s)").
 *  b) "Qué está haciendo cada uno": tareas en_progreso con `desde` = último pase a
 *     en_progreso de la bitácora, más viejas primero.
 *  c) Tabla por usuario (+ fila "Sin asignar") con conteos y TIEMPO PROMEDIO de trabajo
 *     (tramos en_progreso descontando pausas, solo tareas cerradas con tiempo > 0,
 *     atribuido al asignado ACTUAL — regla del legado).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario que mira.
 * @returns {Promise<object|null>} El bloque, o null sin espacios visibles.
 */
export const equipoDashboard = async (models, user) => {
    const { Tarea, TareaCambio, EspacioTrabajo, Lista, User } = models;
    const permisos = await getEspacioPermisos(models, user);
    const visiblesIds = Object.entries(permisos).filter(([, p]) => p.ver).map(([id]) => Number(id));
    const dias = await getDiasPorVencer(models);
    if (!visiblesIds.length) {
        return { tarjetas: null, enProgreso: [], porUsuario: [], dias };
    }
    const cat = sqlCategorias(dias);
    const espaciosSql = `\`tareas\`.\`espacioId\` IN (${visiblesIds.join(',')})`;

    // a) Tarjetas del equipo + "vencidas en N persona(s)".
    const tarjetas = await resumenColumnas(models, visiblesIds, null, dias);
    const personasVencidas = await Tarea.findAll({
        attributes: [[Tarea.sequelize.fn('COUNT', Tarea.sequelize.fn('DISTINCT', Tarea.sequelize.fn('COALESCE', Tarea.sequelize.col('asignadoA'), 0))), 'n']],
        where: Tarea.sequelize.literal(`${espaciosSql} AND ${cat.vencidas}`),
        raw: true
    });
    tarjetas.personasConVencidas = Number(personasVencidas[0]?.n) || 0;

    // b) En progreso ahora mismo, con "desde".
    const enProgresoRows = await Tarea.findAll({
        where: Tarea.sequelize.literal(`${espaciosSql} AND \`tareas\`.\`estado\` = 'en_progreso'`),
        include: [
            { model: User, as: 'asignado', attributes: ['id', 'name', 'lastName'], required: false, paranoid: false },
            { model: Lista, attributes: ['id', 'nombre'], paranoid: false },
            { model: EspacioTrabajo, attributes: ['id', 'nombre'], paranoid: false }
        ]
    });
    const idsProgreso = enProgresoRows.map(t => t.id);
    const desdeRows = idsProgreso.length ? await TareaCambio.findAll({
        attributes: ['tareaId', [TareaCambio.sequelize.fn('MAX', TareaCambio.sequelize.col('createdAt')), 'desde']],
        // `campo: 'estado'` es obligatorio: la bitácora ahora tiene también nombres, fechas y
        // prioridades, y sin el filtro el «desde» saldría de cualquier edición.
        where: { tareaId: { [Op.in]: idsProgreso }, campo: 'estado', valorNuevo: 'en_progreso' },
        group: ['tareaId'],
        raw: true
    }) : [];
    const desdePor = Object.fromEntries(desdeRows.map(r => [r.tareaId, r.desde]));
    const enProgreso = enProgresoRows
        .map(t => {
            const json = t.toJSON();
            return {
                id: json.id,
                nombre: json.nombre,
                prioridad: json.prioridad,
                usuario: json.asignado ? `${json.asignado.name} ${json.asignado.lastName}`.trim() : 'Sin asignar',
                espacioId: json.espacioId,
                espacio: json.espacios_trabajo?.nombre ?? '',
                listaId: json.listaId,
                lista: json.lista?.nombre ?? '',
                vencida: !!(json.fechaVencimiento && json.fechaVencimiento < new Date().toISOString().slice(0, 10)),
                desde: desdePor[json.id] ?? json.createdAt
            };
        })
        .sort((a, b) => String(a.desde).localeCompare(String(b.desde))); // más viejo primero

    // c) Tabla por usuario: conteos agrupados por asignado (0 = sin asignar).
    const S = (cond) => Tarea.sequelize.literal(`COALESCE(SUM(${cond}), 0)`);
    const filas = await Tarea.findAll({
        attributes: [
            [Tarea.sequelize.fn('COALESCE', Tarea.sequelize.col('asignadoA'), 0), 'userId'],
            [S(cat.pendientes), 'pendientes'],
            [S(cat.hoy), 'hoy'],
            [S(cat.por_vencer), 'porVencer'],
            [S(cat.vencidas), 'vencidas'],
            [S(`\`tareas\`.\`estado\` = 'en_progreso'`), 'enProgreso'],
            [S(`\`tareas\`.\`estado\` = 'pausada'`), 'pausadas']
        ],
        where: Tarea.sequelize.literal(`${espaciosSql} AND ${cat.pendientes}`),
        group: [Tarea.sequelize.fn('COALESCE', Tarea.sequelize.col('asignadoA'), 0)],
        raw: true
    });

    // Tiempo promedio: bitácora completa de las asignadas de esos espacios, en una query.
    const asignadas = await Tarea.findAll({
        where: Tarea.sequelize.literal(`${espaciosSql} AND \`tareas\`.\`asignadoA\` IS NOT NULL`),
        attributes: ['id', 'asignadoA'],
        raw: true
    });
    const duenioDe = Object.fromEntries(asignadas.map(t => [t.id, t.asignadoA]));
    const eventos = asignadas.length ? await TareaCambio.findAll({
        where: { tareaId: { [Op.in]: asignadas.map(t => t.id) }, campo: 'estado' },
        order: [['tareaId', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']],
        raw: true
    }) : [];
    const porTarea = {};
    for (const ev of eventos) (porTarea[ev.tareaId] ??= []).push(ev);

    const promedioPor = {}; // userId → { segundos, tareas }
    for (const [tareaId, hist] of Object.entries(porTarea)) {
        // Cerrada = llegó a revisión/completada; se descartan abiertas y con 0 segundos.
        const cerrada = hist.some(h => h.valorNuevo === 'en_revision' || h.valorNuevo === 'completada');
        if (!cerrada) continue;
        let acum = 0, abierto = null;
        for (const ev of hist) {
            const t = new Date(ev.createdAt).getTime();
            if (ev.valorNuevo === 'en_progreso') { if (abierto === null) abierto = t; }
            else if (abierto !== null) { acum += Math.max(0, t - abierto); abierto = null; }
        }
        const segundos = Math.round(acum / 1000);
        if (segundos <= 0) continue;
        const duenio = duenioDe[tareaId]; // atribuido al asignado ACTUAL (regla del legado)
        if (!duenio) continue;
        promedioPor[duenio] ??= { segundos: 0, tareas: 0 };
        promedioPor[duenio].segundos += segundos;
        promedioPor[duenio].tareas += 1;
    }

    const userIds = [...new Set(filas.map(f => Number(f.userId)).filter(Boolean))];
    const usuarios = userIds.length
        ? await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'name', 'lastName', 'active'], paranoid: false, raw: true })
        : [];
    const nombrePor = Object.fromEntries(usuarios.map(u => [u.id, { nombre: `${u.name} ${u.lastName}`.trim(), activo: !!u.active }]));

    const porUsuario = filas.map(f => {
        const uid = Number(f.userId);
        const prom = promedioPor[uid];
        return {
            userId: uid,
            nombre: uid ? (nombrePor[uid]?.nombre ?? 'Sin asignar') : 'Sin asignar',
            activo: uid ? (nombrePor[uid]?.activo ?? false) : true,
            pendientes: Number(f.pendientes) || 0,
            hoy: Number(f.hoy) || 0,
            porVencer: Number(f.porVencer) || 0,
            vencidas: Number(f.vencidas) || 0,
            enProgreso: Number(f.enProgreso) || 0,
            pausadas: Number(f.pausadas) || 0,
            promedio: prom ? { segundos: Math.round(prom.segundos / prom.tareas), sobre: prom.tareas } : null
        };
    }).sort((a, b) => (b.vencidas - a.vencidas) || (b.hoy - a.hoy) || (b.pendientes - a.pendientes) || a.nombre.localeCompare(b.nombre));

    return { tarjetas, enProgreso, porUsuario, dias };
};

/**
 * ¿El usuario puede editar en AL MENOS un espacio? (autorización de subida de archivos:
 * el control fino ocurre al guardar la tarea — regla del legado §1.5).
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario del request.
 * @returns {Promise<boolean>} true si edita en algún espacio.
 */
export const editaEnAlgunEspacio = async (models, user) => {
    const permisos = await getEspacioPermisos(models, user);
    return Object.values(permisos).some(p => p.editar);
};
