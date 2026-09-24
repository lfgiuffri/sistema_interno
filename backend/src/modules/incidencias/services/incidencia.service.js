/**
 * Service del módulo `incidencias` — reclamos y pedidos de los clientes.
 *
 * Una incidencia entra por dos puertas (el portal del cliente o el sistema interno) y sale
 * por una sola: este service. Las rutas del portal y las internas comparten estas funciones;
 * lo único que cambia es QUIÉN pregunta, y eso se resuelve pasando el alcance ya resuelto.
 *
 * Reglas duras:
 *  - El CLIENTE nunca decide el estado. Puede crear y leer; el estado lo mueve el equipo (a
 *    mano o por la tarea vinculada).
 *  - `descripcion` es TEXTO PLANO. Es lo único que recibe contenido desde internet abierto:
 *    sin HTML no hay que sanear nada ni mantener una lista blanca.
 *  - El estado es DERIVADO de la tarea mientras haya `tareaId` y la incidencia no esté
 *    `cerrada`; es MANUAL si no hay tarea o si ya está cerrada. Ese invariante es toda la
 *    lógica de estados de la feature.
 */

import { Op } from 'sequelize';
import { crearNotificacion, usuariosConCapability } from '../../../kernel/index.js';
import { ESTADOS_INCIDENCIA, ESTADOS_TERMINADOS } from '../models/Incidencia.js';

export { ESTADOS_INCIDENCIA, ESTADOS_TERMINADOS };

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
 * Estado de incidencia que corresponde a un estado de tarea — FUENTE ÚNICA del mapeo.
 *
 * Es a propósito un mapeo 5→3 y no 1:1: los estados de la tarea son nuestro kanban interno.
 * Que algo esté «pausado» o «en revisión» no le dice nada al cliente y muestra cómo
 * trabajamos puertas adentro.
 *
 * `abierta → nueva` y no `en_progreso`: que exista una tarea significa que la anotamos, no
 * que alguien la empezó. Decir «estamos trabajando en esto» cuando nadie la tocó es mentirle
 * al cliente, y es exactamente el tipo de mentira por la que después llama.
 *
 * Ningún estado es terminal: mientras haya tarea, la incidencia la sigue. Si reabrimos una
 * tarea porque en realidad no estaba resuelta, el cliente tiene que verlo volver a «en
 * progreso» — que es justamente el caso en el que más le importa enterarse.
 * @param {string} estadoTarea - Estado de la tarea vinculada.
 * @returns {string|null} Estado de incidencia, o null si el estado no se reconoce.
 */
export const estadoDesdeTarea = (estadoTarea) => {
    switch (estadoTarea) {
        case 'abierta': return 'nueva';
        case 'en_progreso':
        case 'pausada':
        case 'en_revision': return 'en_progreso';
        case 'completada': return 'resuelta';
        default: return null;
    }
};

/**
 * Registra un evento en la bitácora de la incidencia, que es TAMBIÉN el outbox del mail.
 *
 * Siempre escribe: la bitácora es auditoría y no puede depender de si el cliente pidió o no
 * que le avisen. Quién recibe (y si recibe) lo decide después el tick del outbox.
 * @param {object} models - Modelos de la app.
 * @param {number} incidenciaId - Incidencia.
 * @param {object} datos - { evento, estadoAnterior?, estadoNuevo?, detalle?, userId?, clienteUsuarioId? }.
 * @param {object} [opts] - { transaction }.
 * @returns {Promise<void>}
 */
export const registrarEvento = async (models, incidenciaId, datos, opts = {}) => {
    await models.IncidenciaCambio.create({
        incidenciaId,
        evento: datos.evento,
        estadoAnterior: datos.estadoAnterior ?? null,
        estadoNuevo: datos.estadoNuevo ?? null,
        detalle: datos.detalle ?? null,
        userId: datos.userId ?? null,
        clienteUsuarioId: datos.clienteUsuarioId ?? null,
        createdAt: new Date()
    }, opts);
};

/**
 * Servicios que un cliente puede elegir al cargar una incidencia.
 *
 * Se DERIVAN de lo que el cliente realmente tiene con nosotros: los servicios de sus abonos
 * ACTIVOS y los de sus proyectos. No hay tabla cliente↔servicio; la relación vive en esas dos.
 *
 * Puede devolver vacío legítimamente (los abonos nacen inactivos, y `Proyecto.servicioId` es
 * nullable), y por eso `servicioId` es opcional en el alta: la UI ofrece «Consulta general».
 * Bloquear al cliente por un dato de facturación sería hacerle pagar nuestra contabilidad.
 * @param {object} models - Modelos de la app.
 * @param {number} clienteId - Cliente.
 * @returns {Promise<Array<{id: number, nombre: string}>>} Servicios, ordenados por nombre.
 */
export const serviciosDelCliente = async (models, clienteId) => {
    const { Abono, Proyecto, Servicio } = models;
    if (!Servicio) return [];

    const ids = new Set();
    if (Abono) {
        const abonos = await Abono.findAll({
            where: { clienteId, activo: true, servicioId: { [Op.ne]: null } },
            attributes: ['servicioId'], group: ['servicioId'], raw: true
        });
        for (const a of abonos) ids.add(Number(a.servicioId));
    }
    if (Proyecto) {
        const proyectos = await Proyecto.findAll({
            where: { clienteId, servicioId: { [Op.ne]: null } },
            attributes: ['servicioId'], group: ['servicioId'], raw: true
        });
        for (const p of proyectos) ids.add(Number(p.servicioId));
    }
    if (!ids.size) return [];

    const servicios = await Servicio.findAll({
        where: { id: { [Op.in]: [...ids] } },
        attributes: ['id', 'nombre'],
        order: [['nombre', 'ASC']],
        raw: true
    });
    return servicios;
};

/**
 * Valida que el servicio elegido sea uno de los del cliente.
 *
 * Se revalida en el servidor aunque la UI solo ofrezca los válidos: el listado es una ayuda,
 * no un permiso. `null` siempre es válido — es la «consulta general».
 * @param {object} models - Modelos de la app.
 * @param {number} clienteId - Cliente.
 * @param {number|null|undefined} servicioId - Servicio elegido.
 * @returns {Promise<number|null>} El servicio validado.
 * @throws {Error} 400 si el servicio no es del cliente.
 */
const validarServicio = async (models, clienteId, servicioId) => {
    if (!servicioId) return null;
    const permitidos = await serviciosDelCliente(models, clienteId);
    if (!permitidos.some(s => s.id === Number(servicioId))) {
        throw bizError(400, 'Ese servicio no corresponde a este cliente');
    }
    return Number(servicioId);
};

/**
 * Includes comunes de la incidencia (para listado y detalle).
 *
 * La TAREA se incluye solo para adentro. Lo que el cliente necesita saber —cuándo calculamos
 * tenerlo— viaja en `fechaEstimada`, copiada a la incidencia; el nombre interno de la tarea,
 * su espacio y su lista son organización nuestra y no tienen por qué salir a internet. Esa es
 * también la razón de copiar la fecha en vez de leerla por el join.
 * @param {object} models - Modelos de la app.
 * @param {boolean} [paraCliente] - true si la respuesta va al portal.
 * @returns {Array} Cláusula `include` de Sequelize.
 */
const incidenciaIncludes = (models, paraCliente = false) => {
    const inc = [];
    if (models.Cliente) inc.push({ model: models.Cliente, attributes: ['id', 'nombre'], paranoid: false });
    if (models.Servicio) inc.push({ model: models.Servicio, attributes: ['id', 'nombre'], paranoid: false });
    if (models.Tarea && !paraCliente) {
        inc.push({ model: models.Tarea, attributes: ['id', 'nombre', 'estado', 'espacioId', 'listaId'], paranoid: false });
    }
    return inc;
};

/**
 * Orden del listado — FUENTE ÚNICA, lo usan el portal y el sistema interno.
 *
 * Las terminadas (resueltas y cerradas) van al FONDO: lo pendiente es lo accionable, y una
 * lista que arranca con seis meses de reclamos resueltos no sirve para nada. Dentro de cada
 * grupo, lo más nuevo primero.
 * @param {import('sequelize').ModelStatic<any>} Incidencia - El modelo (para `literal`).
 * @returns {Array} Cláusula `order` de Sequelize.
 */
const ordenDelListado = (Incidencia) => [
    [Incidencia.sequelize.literal(
        `\`incidencias\`.\`estado\` IN (${ESTADOS_TERMINADOS.map(e => `'${e}'`).join(',')})`
    ), 'ASC'],
    ['createdAt', 'DESC']
];

/**
 * Lista incidencias. El ALCANCE viene resuelto de afuera: el portal pasa el `clienteId` del
 * usuario logueado y el sistema interno pasa lo que filtró el usuario. Este service nunca
 * decide de quién es una incidencia a partir de un parámetro del request.
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - Filtros: clienteId, servicioId, estado (coma), texto, incluirCerradas.
 * @param {boolean} [paraCliente] - true si el listado va al portal (recorta los datos internos).
 * @returns {Promise<object[]>} Incidencias ordenadas (las terminadas al fondo).
 */
export const listIncidencias = async (models, query = {}, paraCliente = false) => {
    const { Incidencia } = models;
    const where = {};

    if (query.clienteId) where.clienteId = Number(query.clienteId);
    if (query.servicioId) where.servicioId = Number(query.servicioId);

    const estados = String(query.estado || '').split(',').filter(e => ESTADOS_INCIDENCIA.includes(e));
    if (estados.length) where.estado = { [Op.in]: estados };
    else if (String(query.incluirCerradas) === 'false') where.estado = { [Op.notIn]: ESTADOS_TERMINADOS };

    if (query.texto) {
        const term = `%${String(query.texto).slice(0, 100).replace(/[%_\\]/g, c => `\\${c}`)}%`;
        where[Op.or] = [{ titulo: { [Op.like]: term } }, { descripcion: { [Op.like]: term } }];
    }

    const filas = await Incidencia.findAll({
        where,
        include: incidenciaIncludes(models, paraCliente),
        order: ordenDelListado(Incidencia)
    });
    return filas.map(f => f.toJSON());
};

/**
 * Una incidencia con su bitácora y sus archivos.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Incidencia.
 * @param {number|null} [clienteId] - Si viene, la incidencia TIENE que ser de ese cliente
 *   (lo usa el portal: un id de otro cliente devuelve null, o sea 404, no 403 — no se le
 *   confirma a nadie que ese id existe).
 * @returns {Promise<object|null>} La incidencia o null.
 */
export const getIncidencia = async (models, id, clienteId = null) => {
    const { Incidencia, IncidenciaCambio, IncidenciaArchivo } = models;
    const where = { id: Number(id) };
    if (clienteId !== null) where.clienteId = Number(clienteId);

    // Que venga `clienteId` ES la señal de que la pide el portal: mismo recorte, sin un flag más.
    const incidencia = await Incidencia.findOne({ where, include: incidenciaIncludes(models, clienteId !== null) });
    if (!incidencia) return null;

    const [historial, archivos] = await Promise.all([
        IncidenciaCambio.findAll({
            where: { incidenciaId: incidencia.id },
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            raw: true
        }),
        IncidenciaArchivo
            ? IncidenciaArchivo.findAll({ where: { incidenciaId: incidencia.id }, order: [['createdAt', 'ASC']], raw: true })
            : []
    ]);

    const json = incidencia.toJSON();
    return {
        ...json,
        historial,
        archivos: archivos.map(a => ({ ...a, url: `/api/incidencias/archivos/${a.nombre}` })),
        // Borrador para el modal de «Crear tarea»: lo mismo que se guardaría si nadie tocara
        // nada. Se calcula acá y no en el frontend para que el texto (y su escapado) tengan UNA
        // sola versión. Solo hacia adentro: al cliente no le importa cómo nombramos su reclamo.
        ...(clienteId === null && !json.tareaId
            ? { borradorTarea: { nombre: json.titulo, descripcion: descripcionPorDefecto(json, json.cliente) } }
            : {})
    };
};

/**
 * Crea una incidencia.
 *
 * `autor` dice de qué lado vino, y se guarda en columnas separadas: son dos espacios de ids
 * distintos y mezclarlos haría que el id 7 signifique dos personas según el contexto.
 * @param {object} models - Modelos de la app.
 * @param {object} data - { clienteId, servicioId?, titulo, descripcion?, archivoIds? }.
 * @param {{userId?: number, clienteUsuarioId?: number}} autor - Quién la carga.
 * @param {object} [io] - Socket.IO, para el aviso al equipo.
 * @returns {Promise<object>} La incidencia creada, con su detalle.
 * @throws {Error} 404 si el cliente no existe; 400 si el servicio no es del cliente.
 */
export const createIncidencia = async (models, data, autor = {}, io = null) => {
    const { Incidencia, Cliente } = models;

    const cliente = await Cliente.findByPk(Number(data.clienteId));
    if (!cliente) throw bizError(404, 'Cliente no encontrado');
    const servicioId = await validarServicio(models, cliente.id, data.servicioId);

    const incidencia = await Incidencia.sequelize.transaction(async (t) => {
        const nueva = await Incidencia.create({
            clienteId: cliente.id,
            servicioId,
            titulo: String(data.titulo).trim(),
            // Texto plano: se normalizan los saltos de línea y nada más.
            descripcion: data.descripcion ? String(data.descripcion).replace(/\r\n/g, '\n').trim() : null,
            estado: 'nueva',
            creadaPorUserId: autor.userId ?? null,
            creadaPorClienteUsuarioId: autor.clienteUsuarioId ?? null
        }, { transaction: t });

        await registrarEvento(models, nueva.id, {
            evento: 'creada',
            estadoNuevo: 'nueva',
            userId: autor.userId,
            clienteUsuarioId: autor.clienteUsuarioId
        }, { transaction: t });

        return nueva;
    });

    await ligarArchivos(models, incidencia, data.archivoIds);
    await avisarAltaAlEquipo(models, io, incidencia, cliente, autor);
    return getIncidencia(models, incidencia.id);
};

/**
 * Avisa al equipo que entró una incidencia: campana, socket y push (los tres salen de
 * `crearNotificacion`, que es el único punto por el que pasan todas las notificaciones).
 *
 * Va DESPUÉS del commit y sin `await` bloqueante sobre el mail: una incidencia cargada no se
 * pierde porque falle un aviso. Destinatarios = quienes pueden verlas (`incidencias:read`);
 * el que la cargó queda afuera — nadie necesita que le avisen lo que acaba de escribir.
 *
 * Es aparte del mail al CLIENTE (ese va por el outbox de `IncidenciaCambio`): son dos avisos
 * distintos, a dos públicos distintos, y uno no reemplaza al otro.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @param {object} incidencia - La recién creada.
 * @param {object} cliente - Cliente dueño (para nombrarlo en el aviso).
 * @param {{userId?: number}} autor - Quién la cargó.
 * @returns {Promise<void>}
 */
const avisarAltaAlEquipo = async (models, io, incidencia, cliente, autor = {}) => {
    try {
        const destinatarios = (await usuariosConCapability(models, 'incidencias:read'))
            .filter(uid => uid !== autor.userId);
        if (!destinatarios.length) return;

        const cuerpo = `${cliente?.nombre ?? 'Cliente'}: ${incidencia.titulo}`;
        await Promise.all(destinatarios.map(userId => crearNotificacion(models, io, {
            userId,
            tipo: 'incidencia_creada',
            titulo: 'Nueva incidencia',
            cuerpo,
            url: `/incidencias?id=${incidencia.id}`
        })));
    } catch {
        // Un aviso que falla no puede tumbar el alta: la incidencia ya está guardada y se ve
        // en el listado. Quedarse sin campana es molesto; perder el reclamo del cliente, no.
    }
};

/**
 * Liga archivos ya subidos (sueltos) a una incidencia.
 *
 * El filtro lleva `clienteId` ADEMÁS de `incidenciaId: null`. En tareas alcanza con «todavía
 * no está ligado» porque todos los que suben son compañeros de trabajo; acá los ids son
 * enteros secuenciales y sin el `clienteId` el cliente A podría quedarse con el adjunto en
 * vuelo del cliente B mandando ids a mano.
 * @param {object} models - Modelos de la app.
 * @param {object} incidencia - Incidencia destino.
 * @param {number[]} [archivoIds] - Ids de archivos sueltos.
 * @returns {Promise<number>} Cuántos quedaron ligados.
 */
export const ligarArchivos = async (models, incidencia, archivoIds) => {
    const { IncidenciaArchivo } = models;
    const ids = (archivoIds || []).map(Number).filter(Boolean);
    if (!IncidenciaArchivo || !ids.length) return 0;

    const [ligados] = await IncidenciaArchivo.update(
        { incidenciaId: incidencia.id },
        { where: { id: ids, incidenciaId: null, clienteId: incidencia.clienteId } }
    );
    return ligados;
};

/**
 * Cambia el estado de una incidencia a mano (solo desde el sistema interno).
 *
 * Tiene sentido mientras la incidencia NO tenga tarea: con una tarea vinculada el estado es
 * derivado y el próximo movimiento de la tarea pisaría el cambio manual. La UI lo refleja
 * apagando los botones; acá no se bloquea para no dejar sin salida un caso raro.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Incidencia.
 * @param {string} estado - Estado nuevo (ya validado).
 * @param {number} userId - Usuario interno que lo cambia.
 * @returns {Promise<object|null>} La incidencia actualizada, o null si no existe.
 */
export const cambiarEstadoIncidencia = async (models, id, estado, userId) => {
    const { Incidencia } = models;
    const incidencia = await Incidencia.findByPk(Number(id));
    if (!incidencia) return null;

    const anterior = incidencia.estado;
    if (anterior === estado) return getIncidencia(models, incidencia.id);

    await Incidencia.sequelize.transaction(async (t) => {
        await incidencia.update({
            estado,
            // Se sella cuándo se resolvió, y se limpia si vuelve para atrás.
            resueltaAt: estado === 'resuelta' ? new Date() : null
        }, { transaction: t });
        await registrarEvento(models, incidencia.id, {
            evento: estado, estadoAnterior: anterior, estadoNuevo: estado, userId
        }, { transaction: t });
    });

    return getIncidencia(models, incidencia.id);
};

/**
 * Edita los datos de una incidencia (no el estado, que tiene su propia acción).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Incidencia.
 * @param {object} data - { titulo?, descripcion?, servicioId? }.
 * @returns {Promise<object|null>} La incidencia actualizada, o null si no existe.
 */
export const updateIncidencia = async (models, id, data) => {
    const { Incidencia } = models;
    const incidencia = await Incidencia.findByPk(Number(id));
    if (!incidencia) return null;

    const patch = {};
    if (data.titulo !== undefined) patch.titulo = String(data.titulo).trim();
    if (data.descripcion !== undefined) {
        patch.descripcion = data.descripcion ? String(data.descripcion).replace(/\r\n/g, '\n').trim() : null;
    }
    if ('servicioId' in data) patch.servicioId = await validarServicio(models, incidencia.clienteId, data.servicioId);

    await incidencia.update(patch);
    return getIncidencia(models, incidencia.id);
};

// ─────────────────────── Vínculo con una tarea del equipo ───────────────────────

/**
 * Crea una TAREA a partir de una incidencia y las deja vinculadas.
 *
 * Copia el título, la descripción y **una copia propia de cada adjunto** (no se comparte el
 * binario: borrar la incidencia no puede vaciarle los adjuntos a la tarea). El vínculo es
 * 1 a 1 y lo garantiza el índice UNIQUE de `tareaId`, así que apretar dos veces el botón
 * devuelve un 409 en vez de generar dos tareas.
 *
 * Desde acá en adelante el estado de la incidencia lo manda la tarea (ver
 * `sincronizarDesdeTarea`), salvo que alguien la cierre a mano.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Usuario interno que aprieta el botón.
 * @param {number} id - Incidencia.
 * @param {{listaId: number}} data - Lista destino de la tarea.
 * @param {object|null} [io] - Socket.IO.
 * @returns {Promise<object>} La incidencia con su tarea ya vinculada.
 * @throws {Error} 404 si no existe; 409 si ya tiene tarea.
 */
export const crearTareaDesdeIncidencia = async (models, user, id, data, io = null) => {
    const { Incidencia, IncidenciaArchivo } = models;
    const incidencia = await Incidencia.findByPk(Number(id));
    if (!incidencia) throw bizError(404, 'Incidencia no encontrada');
    if (incidencia.tareaId) throw bizError(409, 'Esta incidencia ya tiene una tarea');

    const tareas = await import('../../tareas/services/tarea.service.js');
    const cliente = await models.Cliente.findByPk(incidencia.clienteId, { paranoid: false });

    // El alta pasa por `createTarea`, no por un INSERT propio: así hereda las dos capas de
    // permiso del módulo tareas (capability + editar el espacio), la validación de negocio y
    // la bitácora. Duplicar eso acá sería duplicar las reglas. Eso incluye el saneado del
    // HTML de la descripción, que importa porque ahora puede venir del cliente HTTP.
    const tarea = await tareas.createTarea(models, user, {
        listaId: Number(data.listaId),
        // Título y descripción son EDITABLES: el equipo abre el alta de tarea con lo que cargó
        // el cliente ya puesto y lo corrige ahí mismo (un asunto de dos palabras casi nunca es
        // un buen nombre de tarea). Si no vienen, se usa lo que compone este service, que es lo
        // que sigue pasando cuando la llamada no es la del modal.
        nombre: (data.nombre ?? '').trim() || incidencia.titulo,
        descripcion: data.descripcion ?? descripcionPorDefecto(incidencia, cliente),
        // El vencimiento de la tarea es lo que el cliente ve como «fecha estimada»: se carga
        // acá mismo para no tener que entrar después a la tarea a ponerlo.
        fechaVencimiento: data.fechaVencimiento || null,
        fechaInicio: data.fechaInicio || null,
        // Poder asignarla en el mismo paso es la mitad del valor: una incidencia que entra y
        // queda sin dueño es una incidencia que nadie mira.
        asignadoA: data.asignadoA || null,
        prioridad: data.prioridad || 'verde',
        estado: data.estado || 'abierta',
        // Adjuntos que el equipo sumó en el alta (subidos sueltos, como en cualquier tarea).
        // Son DISTINTOS de los de la incidencia, que se copian más abajo.
        archivoIds: data.archivoIds || []
    }, io);

    // Los adjuntos se COPIAN al almacén de tareas: son dos módulos con su propio directorio y
    // su propio índice, y una tarea no puede quedar colgada de un archivo de incidencias que
    // el cliente (o el GC) haga desaparecer.
    let copiados = 0;
    if (IncidenciaArchivo) {
        const { copiarArchivoATarea } = await import('./archivoIncidencia.service.js');
        const archivos = await IncidenciaArchivo.findAll({
            where: { incidenciaId: incidencia.id }, attributes: ['id'], raw: true
        });
        for (const a of archivos) if (await copiarArchivoATarea(models, a.id, tarea.id, user.id)) copiados += 1;
    }

    const estadoNuevo = estadoDesdeTarea(tarea.estado) ?? incidencia.estado;
    await Incidencia.sequelize.transaction(async (t) => {
        await incidencia.update({
            tareaId: tarea.id,
            estado: estadoNuevo,
            fechaEstimada: tarea.fechaVencimiento || null
        }, { transaction: t });
        if (estadoNuevo !== 'nueva' || incidencia.estado !== 'nueva') {
            await registrarEvento(models, incidencia.id, {
                evento: estadoNuevo,
                estadoAnterior: incidencia.estado,
                estadoNuevo,
                detalle: `Se creó la tarea «${tarea.nombre}»`,
                userId: user.id
            }, { transaction: t });
        }
    });

    return { ...(await getIncidencia(models, incidencia.id)), archivosCopiados: copiados };
};

/**
 * Descripción con la que nace la tarea si nadie mandó una.
 *
 * Lleva una referencia a quién la pidió: en el tablero, «de quién es esto» es la primera
 * pregunta. Se expone también en el detalle de la incidencia (`borradorTarea`) para que el
 * modal de alta arranque mostrando EXACTAMENTE lo que se va a guardar — si la compusiera el
 * frontend, habría dos versiones del mismo texto y el escapado en dos lugares.
 * @param {object} incidencia - La incidencia.
 * @param {object|null} cliente - Su cliente (para nombrarlo).
 * @returns {string} HTML listo para la descripción de la tarea.
 */
export const descripcionPorDefecto = (incidencia, cliente) => [
    `<p><strong>Incidencia #${incidencia.id}</strong> — ${escaparHtml(cliente?.nombre ?? 'cliente')}</p>`,
    incidencia.descripcion ? `<p>${escaparHtml(incidencia.descripcion).replace(/\n/g, '<br>')}</p>` : ''
].join('');

/**
 * Escapa el texto plano de la incidencia para poder meterlo en la descripción HTML de la tarea.
 *
 * La descripción de la incidencia viene de internet abierto y es texto plano; la de la tarea
 * es HTML. Sin escapar, un cliente podría inyectar markup en el tablero interno.
 * @param {string} texto - Texto plano.
 * @returns {string} Texto seguro de interpolar en HTML.
 */
const escaparHtml = (texto) => String(texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Baja el estado de la TAREA a la incidencia vinculada — el otro extremo del vínculo.
 *
 * La llaman los dos escritores de bitácora de `tarea.service.js`, que es por donde pasan
 * TODAS las formas de cambiar el estado de una tarea (de a una, en lote, por PUT, al clonar).
 * Engancharse ahí y no en las funciones públicas es lo que evita que una ruta se escape.
 *
 * No hace nada si: el módulo no está montado, la tarea no tiene incidencia, o el estado
 * mapeado es el que ya tenía.
 * @param {object} models - Modelos de la app.
 * @param {number} tareaId - Tarea que cambió.
 * @param {string} estadoTarea - Estado nuevo de la tarea.
 * @param {number|null} userId - Quién lo provocó.
 * @param {object} [opts] - { transaction } — se propaga DENTRO de la misma transacción.
 * @returns {Promise<boolean>} true si movió la incidencia.
 */
export const sincronizarDesdeTarea = async (models, tareaId, estadoTarea, userId, opts = {}) => {
    const { Incidencia } = models;
    if (!Incidencia) return false;

    const incidencia = await Incidencia.findOne({
        where: { tareaId: Number(tareaId) },
        transaction: opts.transaction
    });
    if (!incidencia) return false;

    const nuevo = estadoDesdeTarea(estadoTarea);
    if (!nuevo || nuevo === incidencia.estado) return false;

    const anterior = incidencia.estado;
    await incidencia.update({
        estado: nuevo,
        resueltaAt: nuevo === 'resuelta' ? new Date() : null
    }, { transaction: opts.transaction });
    await registrarEvento(models, incidencia.id, {
        evento: nuevo,
        estadoAnterior: anterior,
        estadoNuevo: nuevo,
        detalle: 'Por el avance de la tarea vinculada',
        userId
    }, opts);
    return true;
};

/**
 * Copia el vencimiento de la tarea a la incidencia como FECHA ESTIMADA de resolución.
 *
 * La fecha se guarda COPIADA y no se lee por el join a propósito: la respuesta del portal ya
 * no incluye la tarea (su nombre, su espacio y su lista son organización interna), y si la
 * tarea se elimina la incidencia se desliga pero la fecha que se le prometió al cliente no
 * tiene por qué evaporarse.
 *
 * No escribe evento ni dispara mail: correr una fecha interna no es un cambio de estado, y
 * un mail por cada vez que alguien acomoda el tablero sería ruido. El cliente la ve la
 * próxima vez que entra al portal.
 * @param {object} models - Modelos de la app.
 * @param {number} tareaId - Tarea que cambió.
 * @param {string|Date|null} fechaVencimiento - Vencimiento nuevo (null la borra).
 * @param {{transaction?: object}} [opts] - Para correr dentro de la transacción del llamador.
 * @returns {Promise<boolean>} true si se actualizó alguna incidencia.
 */
export const sincronizarFechaDesdeTarea = async (models, tareaId, fechaVencimiento, opts = {}) => {
    const { Incidencia } = models;
    if (!Incidencia) return false;

    const incidencia = await Incidencia.findOne({
        where: { tareaId: Number(tareaId) },
        transaction: opts.transaction
    });
    if (!incidencia) return false;

    // `fechaEstimada` es DATEONLY: Sequelize la devuelve como 'YYYY-MM-DD', que es lo mismo
    // que manda la tarea. Comparar como texto evita reescribir la fila por una fecha igual.
    const nueva = fechaVencimiento ? String(fechaVencimiento).slice(0, 10) : null;
    if ((incidencia.fechaEstimada ?? null) === nueva) return false;

    await incidencia.update({ fechaEstimada: nueva }, { transaction: opts.transaction });
    return true;
};

/**
 * Desvincula la incidencia de una tarea que se eliminó.
 *
 * Los borrados de tarea son soft-delete y NO escriben estado, así que no pasan por
 * `sincronizarDesdeTarea`: sin este desenganche la incidencia quedaría apuntando a una tarea
 * invisible y con el estado congelado para siempre (y las tareas no tienen restore).
 * Al soltarse, la incidencia vuelve a ser de manejo MANUAL.
 * @param {object} models - Modelos de la app.
 * @param {number[]} tareaIds - Tareas eliminadas.
 * @param {number|null} userId - Quién las eliminó.
 * @param {object} [opts] - { transaction }.
 * @returns {Promise<number>} Cuántas incidencias se desvincularon.
 */
export const desvincularTareas = async (models, tareaIds, userId, opts = {}) => {
    const { Incidencia } = models;
    const ids = (tareaIds || []).map(Number).filter(Boolean);
    if (!Incidencia || !ids.length) return 0;

    const incidencias = await Incidencia.findAll({
        where: { tareaId: { [Op.in]: ids } },
        transaction: opts.transaction
    });
    for (const incidencia of incidencias) {
        await incidencia.update({ tareaId: null }, { transaction: opts.transaction });
        await registrarEvento(models, incidencia.id, {
            evento: incidencia.estado,
            estadoAnterior: incidencia.estado,
            estadoNuevo: incidencia.estado,
            detalle: 'Se eliminó la tarea vinculada: la incidencia vuelve a manejo manual',
            userId
        }, opts);
    }
    return incidencias.length;
};

/**
 * Elimina (soft) una incidencia.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Incidencia.
 * @returns {Promise<boolean>} true si se eliminó; false si no existe.
 */
export const deleteIncidencia = async (models, id) => {
    const { Incidencia, IncidenciaArchivo } = models;
    const incidencia = await Incidencia.findByPk(Number(id));
    if (!incidencia) return false;
    // Los archivos vuelven a huérfanos y los barre el GC (mismo criterio que documentación).
    if (IncidenciaArchivo) {
        await IncidenciaArchivo.update({ incidenciaId: null }, { where: { incidenciaId: incidencia.id } });
    }
    await incidencia.destroy();
    return true;
};
