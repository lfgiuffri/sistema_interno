/**
 * Sistema Interno — Servicio de webhooks salientes (estilo "database webhooks" de Supabase).
 *
 * Responsabilidad: cuando un módulo dispara un evento (ej. "item:created"), buscar las
 * suscripciones activas interesadas en ese evento, registrar una entrega
 * (WebhookDelivery) y hacer POST a la URL del receptor con reintentos y backoff exponencial.
 *
 * Cada request se firma con HMAC-SHA256 del body usando el secreto de la suscripción
 * (header `X-Sistema-Interno-Signature: sha256=<hex>`), de modo que el receptor pueda verificar
 * autenticidad e integridad. Se incluyen también `X-Sistema-Interno-Event` y `X-Sistema-Interno-Delivery`.
 *
 * Transporte:
 *  - Si hay Redis (getRedis()), se encola el trabajo en una cola BullMQ (`sistema-interno-webhooks-<suffix>`),
 *    que reintenta con backoff fuera del request → no bloquea al caller.
 *  - Si NO hay Redis, se entrega INLINE de forma async (fire-and-forget) con el mismo backoff,
 *    para que el feature degrade con gracia sin Redis.
 *
 * Patrón controller-helper: este archivo no conoce req/res; recibe `models` +
 * datos planos. Es reutilizable desde controllers, scheduler handlers, sockets o jobs.
 */

import crypto from 'crypto';
import { pingRedis, getRedisConfig } from '../../../config/redis.js';

/** Cantidad máxima de intentos de entrega (configurable por entorno). Clamp 1..10. */
const MAX_ATTEMPTS = Math.min(Math.max(parseInt(process.env.WEBHOOKS_MAX_ATTEMPTS, 10) || 5, 1), 10);

/** Timeout por intento de POST (ms). Evita que un receptor lento cuelgue la entrega. */
const REQUEST_TIMEOUT_MS = 10000;

/** Base del backoff exponencial (ms): espera ~ BASE * 2^(intento-1), con tope. */
const BACKOFF_BASE_MS = 1000;

/** Tope del backoff entre reintentos (ms): no esperar más de 30s entre intentos. */
const BACKOFF_MAX_MS = 30000;

/** Comodín de evento: una suscripción con "*" recibe TODOS los eventos. */
const WILDCARD_EVENT = '*';

// Singletons de BullMQ (lazy): se crean en el primer dispatch si hay Redis.
let queue = null;
let worker = null;
let bullmqInitTried = false;

/**
 * Genera un secreto HMAC aleatorio (hex) para una suscripción nueva.
 * @returns {string} 64 caracteres hex (32 bytes de entropía).
 */
export const generateSecret = () => crypto.randomBytes(32).toString('hex');

/**
 * Calcula la firma HMAC-SHA256 de un body en formato `sha256=<hex>`.
 * Es el mismo esquema que usan GitHub/Supabase: el receptor recomputa el HMAC con su copia
 * del secreto y compara para validar que el evento vino realmente del Sistema Interno y no se alteró.
 * @param {string} body - Cuerpo crudo (JSON serializado) que se va a enviar.
 * @param {string} secret - Secreto HMAC de la suscripción.
 * @returns {string} Firma con prefijo, ej. "sha256=ab12...".
 */
export const signPayload = (body, secret) => {
    const hex = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return `sha256=${hex}`;
};

/**
 * Deriva el nombre de la cola BullMQ desde el entorno (aísla colas entre despliegues),
 * igual que hace el servicio de sandbox para no pisar colas de otros entornos.
 * @returns {string} Nombre de la cola (ej. "sistema-interno-webhooks-mydb").
 */
const getQueueName = () => {
    const source = process.env.WEBHOOKS_QUEUE_SUFFIX || process.env.DB_NAME || 'default';
    const suffix = String(source)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'default';
    return `sistema-interno-webhooks-${suffix}`;
};

/**
 * Decide si una suscripción está interesada en un evento dado.
 * Función pura → fácil de testear: matchea por nombre exacto o por comodín "*".
 * @param {string[]} subscribedEvents - Eventos a los que está suscripta (o ["*"]).
 * @param {string} event - Evento disparado.
 * @returns {boolean} true si la suscripción debe recibir el evento.
 */
export const eventMatches = (subscribedEvents, event) => {
    if (!Array.isArray(subscribedEvents)) return false;
    return subscribedEvents.includes(WILDCARD_EVENT) || subscribedEvents.includes(event);
};

/**
 * Realiza UN intento de POST al receptor del webhook con firma HMAC y timeout.
 * No reintenta: el caller (entrega inline o worker BullMQ) maneja el backoff.
 * @param {object} params - Parámetros del intento.
 * @param {string} params.url - URL de destino.
 * @param {string} params.secret - Secreto HMAC de la suscripción.
 * @param {string} params.event - Nombre del evento (header X-Sistema-Interno-Event).
 * @param {number|string} params.deliveryId - ID de la entrega (header X-Sistema-Interno-Delivery).
 * @param {string} params.body - Body JSON ya serializado (se firma tal cual).
 * @returns {Promise<{ok: boolean, status: number|null, error: string|null}>} Resultado del intento.
 */
const attemptDelivery = async ({ url, secret, event, deliveryId, body }) => {
    // AbortController para cortar el fetch si el receptor no responde a tiempo.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                // Firma HMAC del body: permite al receptor verificar origen e integridad.
                'X-Sistema-Interno-Signature': signPayload(body, secret),
                // Nombre del evento, para que el receptor enrute sin parsear el body.
                'X-Sistema-Interno-Event': event,
                // ID de la entrega: permite deduplicar reintentos del lado del receptor.
                'X-Sistema-Interno-Delivery': String(deliveryId),
                'User-Agent': 'SistemaInterno-Webhooks/1.0'
            },
            body
        });
        // Cualquier 2xx se considera éxito; el resto, error con su status para el log.
        if (res.status >= 200 && res.status < 300) {
            return { ok: true, status: res.status, error: null };
        }
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch (err) {
        // Timeout (abort), DNS, conexión rechazada, etc.: sin status, con el mensaje del error.
        const error = err?.name === 'AbortError' ? `Timeout tras ${REQUEST_TIMEOUT_MS}ms` : (err?.message || 'Error de red');
        return { ok: false, status: null, error };
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Calcula el delay del backoff exponencial para un número de intento (1-based).
 * @param {number} attempt - Número de intento que acaba de fallar (1 = primero).
 * @returns {number} Milisegundos a esperar antes del próximo intento (con tope).
 */
const backoffDelay = (attempt) => Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);

/**
 * Espera asíncrona (sleep) en ms. Aislada para poder mockearla en tests.
 * @param {number} ms - Milisegundos a esperar.
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Entrega una WebhookDelivery con reintentos + backoff exponencial, actualizando su estado.
 * Recibe ya los datos planos (no la instancia Sequelize) para poder correr tanto inline como
 * dentro del worker BullMQ (que reconstruye sus propios modelos desde la conexión del tenant).
 *
 * @param {object} models - Modelos del tenant (debe incluir WebhookDelivery).
 * @param {object} delivery - Datos de la entrega.
 * @param {number} delivery.id - ID de la WebhookDelivery a actualizar.
 * @param {string} delivery.url - URL de destino.
 * @param {string} delivery.secret - Secreto HMAC de la suscripción.
 * @param {string} delivery.event - Nombre del evento.
 * @param {object} delivery.payload - Payload del evento (se serializa una sola vez).
 * @returns {Promise<{status: 'success'|'failed', attempts: number, responseStatus: number|null}>} Resultado final.
 */
const runDeliveryWithRetries = async (models, { id, url, secret, event, payload }) => {
    const { WebhookDelivery } = models;
    // Serializamos el body UNA vez: la firma HMAC debe calcularse sobre exactamente estos bytes.
    const body = JSON.stringify(payload ?? {});

    let lastResult = { ok: false, status: null, error: 'Sin intentos' };
    let attempt = 0;

    // Bucle de reintentos: hasta MAX_ATTEMPTS o hasta el primer 2xx.
    while (attempt < MAX_ATTEMPTS) {
        attempt += 1;
        lastResult = await attemptDelivery({ url, secret, event, deliveryId: id, body });

        if (lastResult.ok) break;

        // Si quedan intentos, esperamos el backoff antes del próximo.
        if (attempt < MAX_ATTEMPTS) await sleep(backoffDelay(attempt));
    }

    const finalStatus = lastResult.ok ? 'success' : 'failed';
    // Persistimos el resultado final de la entrega (estado, intentos, último status/error).
    if (WebhookDelivery) {
        await WebhookDelivery.update(
            {
                status: finalStatus,
                attempts: attempt,
                responseStatus: lastResult.status,
                lastError: lastResult.ok ? null : lastResult.error
            },
            { where: { id } }
        ).catch((err) => {
            // No dejamos que un fallo al actualizar el log tumbe el proceso (degradación elegante).
            console.warn('⚠️ [WEBHOOKS] no se pudo actualizar delivery:', err.message);
        });
    }

    return { status: finalStatus, attempts: attempt, responseStatus: lastResult.status };
};

/**
 * Inicializa (lazy) la cola BullMQ y su worker para procesar entregas fuera del request.
 * El worker reconstruye los modelos del tenant desde la conexión cacheada y entrega con backoff.
 * No-op idempotente: solo intenta una vez; si no hay Redis, deja queue=null (fallback inline).
 * @returns {void}
 */
const ensureQueue = () => {
    if (bullmqInitTried) return;
    bullmqInitTried = true;

    // Probe real de Redis: getRedis() devolvía una conexión "truthy" aunque Redis
    // estuviera caído (conecta async), así que este guard nunca disparaba y BullMQ
    // creaba conexiones cuyo error 'error' quedaba sin capturar → crash. Con el ping
    // acotado, sin Redis se degrada a entrega inline (queue=null).
    pingRedis().then((available) => {
        if (!available) return; // sin Redis → el dispatch usará entrega inline.
        // Import diferido de BullMQ: si la lib no estuviera, no rompemos el arranque del módulo.
        const name = getQueueName();
        const connection = getRedisConfig();

        return import('bullmq').then(({ Queue, Worker }) => {
            queue = new Queue(name, {
                connection,
                // El propio job de BullMQ reintenta con backoff; igualmente nuestro runDelivery
                // reintenta internamente, así que acá 1 sola pasada de job alcanza.
                defaultJobOptions: { removeOnComplete: 50, removeOnFail: 100, attempts: 1 }
            });
            queue.on('error', (err) => console.warn('⚠️ [WEBHOOKS] Queue error:', err.message));

            // Worker: usa los modelos singleton de la app (single-tenant) y entrega con backoff.
            worker = new Worker(name, async (job) => {
                const { deliveryId, url, secret, event, payload } = job.data;
                const { getModels } = await import('../../../database.js');
                await runDeliveryWithRetries(getModels(), { id: deliveryId, url, secret, event, payload });
            }, { connection });

            worker.on('failed', (job, err) => {
                console.warn('⚠️ [WEBHOOKS] job falló:', err?.message, 'job:', job?.id);
            });
            worker.on('error', (err) => console.warn('⚠️ [WEBHOOKS] Worker error:', err.message));

            console.log(`✅ [WEBHOOKS] Cola BullMQ lista (${name})`);
        }).catch((err) => {
            // Si BullMQ no carga, degradamos a entrega inline (queue queda null).
            console.warn('⚠️ [WEBHOOKS] BullMQ no disponible, entrega inline:', err.message);
            queue = null;
        });
    }).catch((err) => {
        console.warn('⚠️ [WEBHOOKS] init de cola falló, entrega inline:', err.message);
        queue = null;
    });
};

/**
 * Despacha un evento a todas las suscripciones activas interesadas.
 *
 * Por cada suscripción que matchea (por nombre o "*") crea una WebhookDelivery (status pending)
 * y la entrega: encolada en BullMQ si hay Redis, o inline async con backoff si no. NUNCA tira:
 * los webhooks son un side-effect: un fallo de entrega no debe romper la operación que los disparó.
 *
 * @param {object} models - Modelos de la app (req.models). Debe incluir WebhookSubscription/WebhookDelivery.
 * @param {string} event - Nombre del evento (ej. "item:created").
 * @param {object} payload - Datos del evento (se serializan tal cual en el body).
 * @param {object} [io] - Instancia de Socket.IO (opcional; para emitir un eco del dispatch al cliente).
 * @returns {Promise<{dispatched: number, deliveryIds: number[]}>} Cuántas entregas se crearon.
 */
export const dispatch = async (models, event, payload, io = null) => {
    try {
        const { WebhookSubscription, WebhookDelivery } = models || {};
        // Sin los modelos del feature (tenant con provisión parcial) → no hay nada que despachar.
        if (!WebhookSubscription || !WebhookDelivery) return { dispatched: 0, deliveryIds: [] };

        // Buscamos las suscripciones activas y filtramos en memoria por match de evento.
        // (events es JSON; filtrar en SQL sería específico del motor, así que se filtra acá.)
        const subs = await WebhookSubscription.findAll({ where: { active: true } });
        const targets = subs.filter((s) => eventMatches(s.events, event));
        if (targets.length === 0) return { dispatched: 0, deliveryIds: [] };

        // Aseguramos la cola (lazy) una vez; si no hay Redis, queda en modo inline.
        ensureQueue();

        const deliveryIds = [];

        for (const sub of targets) {
            // 1) Registramos la entrega en estado pending (queda traza aunque la entrega falle).
            const delivery = await WebhookDelivery.create({
                subscriptionId: sub.id,
                event,
                payload,
                status: 'pending',
                attempts: 0
            });
            deliveryIds.push(delivery.id);

            const jobData = {
                deliveryId: delivery.id,
                url: sub.url,
                secret: sub.secret,
                event,
                payload
            };

            // 2) Transporte: encolar si hay BullMQ; si no, entregar inline (fire-and-forget).
            if (queue) {
                await queue.add('deliver', jobData).catch(async (err) => {
                    // Si el encolado falla en runtime, no perdemos el evento: caemos a inline.
                    console.warn('⚠️ [WEBHOOKS] enqueue falló, entrega inline:', err.message);
                    runDeliveryWithRetries(models, { id: delivery.id, url: sub.url, secret: sub.secret, event, payload })
                        .catch((e) => console.warn('⚠️ [WEBHOOKS] entrega inline falló:', e.message));
                });
            } else {
                // Inline async: NO await (no bloqueamos la operación que disparó el webhook).
                runDeliveryWithRetries(models, { id: delivery.id, url: sub.url, secret: sub.secret, event, payload })
                    .catch((e) => console.warn('⚠️ [WEBHOOKS] entrega inline falló:', e.message));
            }
        }

        // Eco opcional a los clientes conectados: útil para que la UI muestre "evento despachado".
        if (io) {
            io.to('app').emit('webhook:dispatched', { event, deliveries: deliveryIds.length });
        }

        return { dispatched: deliveryIds.length, deliveryIds };
    } catch (error) {
        // Side-effect: jamás propagamos el error al caller del dominio.
        console.warn('⚠️ [WEBHOOKS] dispatch falló:', error.message);
        return { dispatched: 0, deliveryIds: [] };
    }
};

// ─── Helpers CRUD de suscripciones / deliveries (lógica para los controllers) ───

/**
 * Crea una suscripción de webhook para el tenant (genera el secreto HMAC en el server).
 * @param {object} models - Modelos del tenant.
 * @param {number|null} userId - Dueño de la suscripción (o null si es a nivel tenant).
 * @param {{url: string, events?: string[], active?: boolean}} data - Datos validados.
 * @returns {Promise<object>} La suscripción creada (incluye el `secret` para mostrarlo una vez).
 */
export const createSubscription = async (models, userId, data) => {
    const { WebhookSubscription } = models;
    // El secreto SIEMPRE lo genera el server (nunca se confía en uno provisto por el cliente).
    const secret = generateSecret();
    return WebhookSubscription.create({
        userId: userId ?? null,
        url: data.url,
        // Default a ["*"] si no se especifican eventos (suscripción a todo).
        events: Array.isArray(data.events) && data.events.length ? data.events : ['*'],
        active: data.active !== undefined ? data.active : true,
        secret
    });
};

/**
 * Lista las suscripciones de webhook del tenant.
 * @param {object} models - Modelos del tenant.
 * @param {object} [query] - Query params crudos (active opcional para filtrar).
 * @returns {Promise<object[]>} Suscripciones (más recientes primero).
 */
export const listSubscriptions = async (models, query = {}) => {
    const { WebhookSubscription } = models;
    const where = {};
    // Filtro opcional por estado activo/inactivo.
    if (query.active !== undefined) where.active = query.active === true || query.active === 'true';
    return WebhookSubscription.findAll({ where, order: [['createdAt', 'DESC']] });
};

/**
 * Busca una suscripción por id.
 * @param {object} models - Modelos del tenant.
 * @param {number} id - ID de la suscripción.
 * @returns {Promise<object|null>} La suscripción o null si no existe.
 */
export const getSubscription = async (models, id) => {
    const { WebhookSubscription } = models;
    return WebhookSubscription.findByPk(id);
};

/**
 * Elimina (soft-delete) una suscripción de webhook.
 * @param {object} models - Modelos del tenant.
 * @param {number} id - ID de la suscripción a borrar.
 * @returns {Promise<boolean>} true si se borró; false si no existía.
 */
export const deleteSubscription = async (models, id) => {
    const { WebhookSubscription } = models;
    const sub = await WebhookSubscription.findByPk(id);
    if (!sub) return false;
    await sub.destroy(); // soft-delete (paranoid).
    return true;
};

/**
 * Lista las entregas (log) del tenant, opcionalmente filtradas por suscripción/estado.
 * @param {object} models - Modelos del tenant.
 * @param {object} [query] - Query params crudos (subscriptionId, status, page, limit).
 * @returns {Promise<{rows: object[], count: number, page: number, limit: number}>} Filas + datos de paginación.
 */
export const listDeliveries = async (models, query = {}) => {
    const { WebhookDelivery } = models;
    const where = {};
    if (query.subscriptionId) where.subscriptionId = parseInt(query.subscriptionId, 10);
    if (query.status) where.status = query.status;

    // Paginación defensiva (clamp) para evitar dumps gigantes del log.
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const { rows, count } = await WebhookDelivery.findAndCountAll({
        where,
        limit,
        offset,
        order: [['createdAt', 'DESC']]
    });
    return { rows, count, page, limit };
};
