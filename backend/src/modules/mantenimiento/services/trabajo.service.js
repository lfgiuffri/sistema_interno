/**
 * Trabajos de FullGlass: correr SQL sobre las bases de los clientes y disparar deploys.
 *
 * Reemplaza entrar por SSH a cada VPS. El modelo es **PULL**: la app no se conecta a ningún
 * servidor; el agente pregunta si tiene trabajo y lo ejecuta él. Así el módulo conserva la
 * propiedad de la que vive —ningún puerto abierto, cero credenciales de servidor guardadas—
 * aun habilitando ejecución remota.
 *
 * Las defensas, en orden de importancia:
 *  1. El servidor tiene que estar marcado `tieneFullglass`. Es el filtro contra mandarle un
 *     deploy al VPS equivocado.
 *  2. El servidor tiene que estar ONLINE al lanzar. Si no, ese trabajo nace en `error` en vez
 *     de quedar encolado: un deploy que se dispara solo tres días después, cuando ya nadie se
 *     acuerda de haberlo pedido, es peor que uno que no corrió.
 *  3. El SQL se corre primero en UNA base por servidor (el «canario») y no sigue hasta que una
 *     persona aprueba. Un `ALTER TABLE` no se puede deshacer —MySQL hace commit implícito en
 *     DDL—, así que la única red real es romper una base en vez de doscientas.
 *  4. Las sentencias catastróficas se detectan y exigen confirmación escrita.
 *  5. El comando de deploy se COPIA al trabajo al lanzarlo. Si alguien lo edita mientras el
 *     agente lo está por tomar, corre el que se aprobó, no el nuevo.
 */

import crypto from 'crypto';
import { Op } from 'sequelize';
import { ESTADOS_TOMABLES } from '../models/ServidorTrabajo.js';

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

/** Tope de la salida que se guarda de un deploy (lo que sobra se recorta por el principio). */
const MAX_SALIDA = 256 * 1024;

/** Estados en los que el agente ya se llevó el trabajo y todavía no reportó. */
const ESTADOS_EN_CURSO = ['canario', 'corriendo'];

/**
 * Minutos sin reportar a partir de los cuales un trabajo se considera huérfano y se puede
 * destrabar a mano. Más alto que el timeout del worker (30 min para un deploy): por debajo de
 * eso, lo más probable es que siga trabajando.
 */
const MINUTOS_HUERFANO = 45;

/**
 * Patrones de sentencias que pueden dejar a un cliente sin datos y sin vuelta atrás.
 *
 * NO es una defensa de seguridad —quien escribe el SQL ya tiene permiso para romper cosas— y
 * no pretende ser exhaustiva: es un freno contra el copiar/pegar equivocado y el dedo rápido.
 * Por eso avisa y pide confirmación escrita en vez de bloquear: el día que haga falta un DROP
 * de verdad, bloquearlo obligaría a entrar al servidor a mano, que es lo que queremos dejar
 * de hacer.
 */
const PATRONES_PELIGROSOS = [
    { re: /\bDROP\s+(DATABASE|SCHEMA)\b/i, que: 'DROP DATABASE' },
    { re: /\bDROP\s+TABLE\b/i, que: 'DROP TABLE' },
    { re: /\bTRUNCATE\b/i, que: 'TRUNCATE' },
    { re: /\bDROP\s+COLUMN\b/i, que: 'DROP COLUMN' },
    // Un DELETE o UPDATE sin WHERE toca la tabla entera. Es el error clásico de estos scripts.
    { re: /\bDELETE\s+FROM\s+[^;]*$/i, que: 'DELETE sin WHERE', exigeSinWhere: true },
    { re: /\bUPDATE\s+[^;]*\bSET\b[^;]*$/i, que: 'UPDATE sin WHERE', exigeSinWhere: true },
    { re: /\bGRANT\b|\bREVOKE\b|\bCREATE\s+USER\b|\bSET\s+PASSWORD\b/i, que: 'cambio de permisos o usuarios' },
];

/**
 * Parte el SQL en sentencias, ignorando las líneas en blanco y los comentarios.
 *
 * Es un split por `;` deliberadamente simple: NO es un parser de SQL y no pretende serlo. Lo
 * usa el análisis de riesgo y el conteo que se le muestra al usuario; quien ejecuta de verdad
 * es el cliente `mysql` en el servidor, que sí entiende SQL.
 * @param {string} sql - Texto crudo.
 * @returns {string[]} Sentencias sin el `;` final.
 */
export const partirSentencias = (sql) => String(sql || '')
    .split(/;\s*(?:\n|$)/)
    .map(s => s.replace(/^\s*(--|#).*$/gm, '').trim())
    .filter(Boolean);

/**
 * Revisa el SQL y devuelve qué tiene de peligroso.
 * @param {string} sql - Texto crudo.
 * @returns {{sentencias: string[], peligros: Array<{que: string, sentencia: string}>}} Análisis.
 */
export const analizarSql = (sql) => {
    const sentencias = partirSentencias(sql);
    const peligros = [];
    for (const sentencia of sentencias) {
        for (const p of PATRONES_PELIGROSOS) {
            if (!p.re.test(sentencia)) continue;
            // Los patrones de «sin WHERE» solo avisan si efectivamente no hay WHERE.
            if (p.exigeSinWhere && /\bWHERE\b/i.test(sentencia)) continue;
            peligros.push({ que: p.que, sentencia: sentencia.slice(0, 200) });
        }
    }
    return { sentencias, peligros };
};

/**
 * Valida que un servidor pueda recibir trabajos y devuelve la fila.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Servidor.
 * @returns {Promise<object>} El servidor.
 * @throws {Error} 404 si no existe; 400 si no tiene FullGlass o no lleva agente.
 */
const exigirServidorFullglass = async (models, id) => {
    const servidor = await models.Servidor.findByPk(Number(id));
    if (!servidor) throw bizError(404, 'Servidor no encontrado');
    if (!servidor.tieneFullglass) throw bizError(400, `«${servidor.nombre}» no está marcado como servidor con FullGlass`);
    if (!servidor.monitorea) throw bizError(400, `«${servidor.nombre}» no tiene agente instalado: no se le puede ejecutar nada`);
    if (!servidor.activo) throw bizError(400, `«${servidor.nombre}» está inactivo`);
    return servidor;
};

/**
 * Lanza un LOTE: un trabajo por servidor, todos con el mismo `loteId`.
 *
 * Los servidores sin contacto NO se encolan: su trabajo nace en `error`. Queda en el historial
 * —hace falta saber que se intentó— pero no se va a ejecutar solo más tarde.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Quién lanza.
 * @param {object} datos - `{ tipo, servidorIds, sql?, entorno?, sitios?, confirmacion? }`.
 * @returns {Promise<{loteId: string, trabajos: object[]}>} Los trabajos creados.
 * @throws {Error} 400 si falta confirmación para sentencias peligrosas o falta el comando.
 */
export const crearLote = async (models, user, datos) => {
    const { ServidorTrabajo } = models;
    const ids = [...new Set((datos.servidorIds || []).map(Number).filter(Boolean))];
    if (!ids.length) throw bizError(400, 'Elegí al menos un servidor');

    // El análisis de riesgo se hace UNA vez sobre el SQL, antes de tocar nada.
    if (datos.tipo === 'sql') {
        const { sentencias, peligros } = analizarSql(datos.sql);
        if (!sentencias.length) throw bizError(400, 'No hay ninguna sentencia para ejecutar');
        if (peligros.length && String(datos.confirmacion || '').trim().toUpperCase() !== 'CONFIRMO') {
            throw bizError(400, `El SQL tiene sentencias peligrosas (${peligros.map(p => p.que).join(', ')}). Escribí CONFIRMO para habilitarlo.`);
        }
    }

    const loteId = crypto.randomUUID();
    const creados = [];

    for (const id of ids) {
        const servidor = await exigirServidorFullglass(models, id);

        // El comando se COPIA ahora: si alguien lo edita mientras tanto, corre el aprobado.
        let comando = null;
        if (datos.tipo === 'deploy') {
            comando = datos.entorno === 'produccion' ? servidor.comandoDeployProd : servidor.comandoDeployDev;
            if (!comando || !comando.trim()) {
                throw bizError(400, `«${servidor.nombre}» no tiene configurado el comando de deploy de ${datos.entorno}`);
            }
        }

        // Sin contacto = error en el momento, no cola.
        const sinContacto = servidor.estado !== 'online';

        creados.push(await ServidorTrabajo.create({
            loteId,
            servidorId: servidor.id,
            tipo: datos.tipo,
            estado: sinContacto ? 'error' : 'pendiente',
            error: sinContacto ? 'El servidor estaba sin contacto al lanzar: no se ejecutó nada' : null,
            finalizadoAt: sinContacto ? new Date() : null,
            sql: datos.tipo === 'sql' ? String(datos.sql) : null,
            comando,
            entorno: datos.tipo === 'deploy' ? datos.entorno : null,
            sitios: datos.sitios?.length ? JSON.stringify(datos.sitios) : null,
            userId: user?.id ?? null,
        }));
    }

    return { loteId, trabajos: creados.map(t => t.toJSON()) };
};

/**
 * Aprueba seguir con el resto de las bases después de un canario exitoso.
 * @param {object} models - Modelos de la app.
 * @param {object} user - Quién aprueba.
 * @param {number} id - Trabajo.
 * @returns {Promise<object>} El trabajo actualizado.
 * @throws {Error} 404 si no existe; 409 si no está esperando aprobación.
 */
export const aprobarTrabajo = async (models, user, id) => {
    const trabajo = await models.ServidorTrabajo.findByPk(Number(id));
    if (!trabajo) throw bizError(404, 'Trabajo no encontrado');
    if (trabajo.estado !== 'espera_ok') {
        throw bizError(409, 'Este trabajo no está esperando aprobación');
    }
    await trabajo.update({ estado: 'aprobado', aprobadoPorUserId: user?.id ?? null, aprobadoAt: new Date() });
    return trabajo.toJSON();
};

/**
 * Cancela un trabajo que todavía no empezó a ejecutarse.
 *
 * Solo se puede cancelar lo que el agente aún no tomó: una vez que el SQL está corriendo en
 * una base, frenarlo desde acá sería mentir (el agente ya está adentro de la transacción).
 * @param {object} models - Modelos de la app.
 * @param {number} id - Trabajo.
 * @returns {Promise<object>} El trabajo actualizado.
 * @throws {Error} 404 si no existe; 409 si ya está corriendo o terminó.
 */
export const cancelarTrabajo = async (models, id) => {
    const trabajo = await models.ServidorTrabajo.findByPk(Number(id));
    if (!trabajo) throw bizError(404, 'Trabajo no encontrado');

    if (['pendiente', 'espera_ok', 'aprobado'].includes(trabajo.estado)) {
        await trabajo.update({ estado: 'cancelado', finalizadoAt: new Date() });
        return trabajo.toJSON();
    }

    // DESTRABAR un huérfano. Si el agente murió a mitad (reinicio del VPS, un kill, la red),
    // el trabajo queda en `canario`/`corriendo` y nadie lo vuelve a tomar: sin esta salida se
    // queda así para siempre y hay que entrar a la base a arreglarlo.
    //
    // Solo se permite pasado el umbral, que es más alto que el timeout del propio worker
    // (30 min para un deploy): antes de eso, lo más probable es que siga trabajando de verdad.
    if (ESTADOS_EN_CURSO.includes(trabajo.estado)) {
        const minutos = trabajo.tomadoAt ? (Date.now() - new Date(trabajo.tomadoAt).getTime()) / 60000 : Infinity;
        if (minutos < MINUTOS_HUERFANO) {
            throw bizError(409, `El trabajo está corriendo. Se puede destrabar recién a los ${MINUTOS_HUERFANO} minutos sin respuesta.`);
        }
        await trabajo.update({
            estado: 'error',
            // Se dice explícitamente que lo cortó una persona: el agente nunca reportó, así
            // que afirmar que «falló» a secas sería inventar lo que pasó en el servidor.
            error: 'Destrabado a mano: el agente no reportó. Puede haber quedado aplicado en el servidor.',
            finalizadoAt: new Date(),
        });
        return trabajo.toJSON();
    }

    throw bizError(409, `No se puede cancelar un trabajo en estado «${trabajo.estado}»`);
};

/**
 * Historial de trabajos, con su servidor y quién los lanzó.
 * @param {object} models - Modelos de la app.
 * @param {object} [query] - `{ servidorId, tipo, estado, limit }`.
 * @returns {Promise<object[]>} Trabajos, el más nuevo primero.
 */
export const listTrabajos = async (models, query = {}) => {
    const { ServidorTrabajo, Servidor, User } = models;
    const where = {};
    if (query.servidorId) where.servidorId = Number(query.servidorId);
    if (query.tipo) where.tipo = String(query.tipo);
    if (query.estado) where.estado = String(query.estado);

    const filas = await ServidorTrabajo.findAll({
        where,
        include: [
            ...(Servidor ? [{ model: Servidor, attributes: ['id', 'nombre'], paranoid: false }] : []),
            ...(User ? [{ model: User, attributes: ['id', 'name', 'lastName'], paranoid: false }] : []),
        ],
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit: Math.min(Number(query.limit) || 100, 500),
    });
    return filas.map(f => f.toJSON());
};

/**
 * Un trabajo con el detalle base por base.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Trabajo.
 * @returns {Promise<object|null>} El trabajo con `resultados`, o null.
 */
export const getTrabajo = async (models, id) => {
    const { ServidorTrabajo, ServidorTrabajoResultado, Servidor } = models;
    const trabajo = await ServidorTrabajo.findByPk(Number(id), {
        include: Servidor ? [{ model: Servidor, attributes: ['id', 'nombre'], paranoid: false }] : [],
    });
    if (!trabajo) return null;
    const resultados = await ServidorTrabajoResultado.findAll({
        where: { trabajoId: trabajo.id },
        order: [['esCanario', 'DESC'], ['id', 'ASC']],
        raw: true,
    });
    // Con `raw: true` Sequelize no castea: MySQL devuelve el BOOLEAN como 1/0 y la API
    // terminaría publicando un número donde el contrato dice booleano.
    return { ...trabajo.toJSON(), resultados: resultados.map(r => ({ ...r, esCanario: !!r.esCanario })) };
};

// ─────────────────────────── Lado del AGENTE ───────────────────────────

/**
 * Trabajos que este servidor tiene para ejecutar ahora.
 *
 * Devuelve TODO lo necesario para correr sin volver a preguntar (el SQL, el comando, los
 * sitios elegidos) y le dice al agente en qué fase está: `canario` = probar en una sola base,
 * `resto` = las demás. Lo que el agente NO recibe nunca son credenciales: las lee él de
 * `config_site.php` en el propio servidor.
 * @param {object} models - Modelos de la app.
 * @param {object} servidor - El servidor autenticado por su token.
 * @returns {Promise<object[]>} Trabajos a ejecutar (normalmente 0 o 1).
 */
export const trabajosPendientes = async (models, servidor) => {
    const { ServidorTrabajo } = models;
    const filas = await ServidorTrabajo.findAll({
        where: { servidorId: servidor.id, estado: { [Op.in]: ESTADOS_TOMABLES } },
        order: [['id', 'ASC']],
        limit: 5,
    });

    return filas.map(t => ({
        id: t.id,
        tipo: t.tipo,
        // El canario solo aplica al SQL: un deploy no se puede «probar en uno».
        fase: t.tipo === 'sql' ? (t.estado === 'pendiente' ? 'canario' : 'resto') : 'unico',
        sql: t.sql,
        comando: t.comando,
        rutaSitios: servidor.rutaSitios,
        sitios: t.sitios ? JSON.parse(t.sitios) : null,
    }));
};

/**
 * El agente avisa que tomó un trabajo (para que la pantalla lo muestre corriendo).
 * @param {object} models - Modelos de la app.
 * @param {object} servidor - Servidor autenticado.
 * @param {number} trabajoId - Trabajo.
 * @returns {Promise<boolean>} true si se marcó.
 */
export const marcarTomado = async (models, servidor, trabajoId) => {
    const trabajo = await models.ServidorTrabajo.findOne({
        where: { id: Number(trabajoId), servidorId: servidor.id, estado: { [Op.in]: ESTADOS_TOMABLES } },
    });
    if (!trabajo) return false;
    const esCanario = trabajo.tipo === 'sql' && trabajo.estado === 'pendiente';
    await trabajo.update({ estado: esCanario ? 'canario' : 'corriendo', tomadoAt: new Date() });
    return true;
};

/**
 * El agente reporta cómo terminó (o cómo le fue al canario).
 *
 * Un trabajo de SQL en fase canario NO pasa a `ok`: queda en `espera_ok` esperando que una
 * persona apruebe seguir. Si el canario falló, pasa a `error` y el resto no se toca — que es
 * exactamente para lo que existe.
 * @param {object} models - Modelos de la app.
 * @param {object} servidor - Servidor autenticado.
 * @param {number} trabajoId - Trabajo.
 * @param {object} datos - `{ ok, salida, error, resultados: [{sitio, base, estado, ...}] }`.
 * @returns {Promise<object|null>} El trabajo actualizado, o null si no es suyo.
 */
export const reportarResultado = async (models, servidor, trabajoId, datos) => {
    const { ServidorTrabajo, ServidorTrabajoResultado } = models;
    const trabajo = await ServidorTrabajo.findOne({
        where: { id: Number(trabajoId), servidorId: servidor.id },
    });
    if (!trabajo) return null;

    const eraCanario = trabajo.estado === 'canario';
    const filas = Array.isArray(datos.resultados) ? datos.resultados : [];

    if (filas.length) {
        await ServidorTrabajoResultado.bulkCreate(filas.slice(0, 1000).map(r => ({
            trabajoId: trabajo.id,
            sitio: String(r.sitio || '').slice(0, 255),
            base: r.base ? String(r.base).slice(0, 120) : null,
            estado: ['ok', 'error', 'omitido'].includes(r.estado) ? r.estado : 'error',
            esCanario: eraCanario,
            filasAfectadas: Number.isFinite(Number(r.filasAfectadas)) ? Number(r.filasAfectadas) : null,
            sentenciasOk: Number.isFinite(Number(r.sentenciasOk)) ? Number(r.sentenciasOk) : null,
            error: r.error ? String(r.error).slice(0, 1000) : null,
            ms: Number.isFinite(Number(r.ms)) ? Number(r.ms) : null,
        })));
    }

    const huboError = datos.ok === false || filas.some(r => r.estado === 'error');
    // La salida se recorta por el PRINCIPIO: en un deploy largo, lo que importa es el final
    // (dónde falló), no el banner del arranque.
    const salida = datos.salida ? String(datos.salida).slice(-MAX_SALIDA) : null;

    const estado = huboError ? 'error' : (eraCanario ? 'espera_ok' : 'ok');
    await trabajo.update({
        estado,
        salida: salida ?? trabajo.salida,
        error: datos.error ? String(datos.error).slice(0, 500) : trabajo.error,
        finalizadoAt: estado === 'espera_ok' ? null : new Date(),
    });
    return trabajo.toJSON();
};

/**
 * Guarda el inventario de sitios que reporta el agente (reemplaza el anterior).
 *
 * Se reemplaza entero y no se hace merge: un sitio que ya no está tiene que desaparecer, si no
 * la vista previa invitaría a correr SQL sobre un cliente que se dio de baja.
 * @param {object} models - Modelos de la app.
 * @param {object} servidor - Servidor autenticado.
 * @param {Array<{ruta: string, base?: string, problema?: string}>} sitios - Lo encontrado.
 * @returns {Promise<number>} Cuántos sitios quedaron registrados.
 */
export const guardarInventario = async (models, servidor, sitios) => {
    const { ServidorSitio } = models;
    if (!ServidorSitio || !Array.isArray(sitios)) return 0;

    const ahora = new Date();
    const filas = sitios.slice(0, 500).map(s => ({
        servidorId: servidor.id,
        ruta: String(s.ruta || '').slice(0, 255),
        base: s.base ? String(s.base).slice(0, 120) : null,
        problema: s.problema ? String(s.problema).slice(0, 255) : null,
        ultimoReporteAt: ahora,
    })).filter(s => s.ruta);

    await ServidorSitio.sequelize.transaction(async (t) => {
        await ServidorSitio.destroy({ where: { servidorId: servidor.id }, transaction: t });
        if (filas.length) await ServidorSitio.bulkCreate(filas, { transaction: t });
        // Se sella aunque la lista venga VACÍA: es la única forma de distinguir después «no
        // encontró sitios» de «el worker nunca habló».
        await servidor.update({ sitiosReportadosAt: ahora }, { transaction: t });
    });
    return filas.length;
};

/**
 * Sitios conocidos de un servidor, para la vista previa antes de lanzar.
 * @param {object} models - Modelos de la app.
 * @param {number} servidorId - Servidor.
 * @returns {Promise<object[]>} Sitios con su base y su último reporte.
 */
export const listSitios = async (models, servidorId) => {
    const { ServidorSitio } = models;
    if (!ServidorSitio) return [];
    return ServidorSitio.findAll({
        where: { servidorId: Number(servidorId) },
        order: [['ruta', 'ASC']],
        raw: true,
    });
};
