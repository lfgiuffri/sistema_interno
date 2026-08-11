/**
 * Sistema Interno — Lado BACKEND de la cola de sandbox (genérico, sin dominio).
 *
 * El backend ENCOLA jobs de ejecución y escucha su finalización (QueueEvents) para
 * reaccionar al resultado. El WORKER corre en una VM aislada (VM-Sandbox), ejecuta el
 * código no confiable y devuelve el resultado SIN tocar la base ni los secrets.
 *
 * La persistencia del resultado es pluggable: quien quiera guardar/reaccionar registra
 * un handler vía setSandboxResultHandler (kernel/handlerRegistry.js). Sin handler, solo
 * se emite un evento `sandbox:completed` genérico.
 */

import { Queue, QueueEvents } from 'bullmq';
import { getRedisConfig } from '../../../config/redis.js';
import { db, getModels } from '../../../database.js';
import { getSandboxResultHandler } from '../../../kernel/handlerRegistry.js';
import { SANDBOX } from '../config/sandbox.config.js';

let queue = null;
let queueEvents = null;
let ioInstance = null;

/**
 * Inyecta la instancia de Socket.IO usada para emitir eventos de resultado.
 * @param {object} io - Instancia de Socket.IO.
 * @returns {void}
 */
export const setSandboxIO = (io) => { ioInstance = io; };

/**
 * Deriva el nombre de la cola desde el entorno (aísla colas entre despliegues).
 * @returns {string} Nombre de la cola BullMQ.
 */
const getQueueName = () => {
    const source = process.env.SANDBOX_QUEUE_SUFFIX || process.env.DB_NAME || 'default';
    const suffix = String(source).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'default';
    return `zero-sandbox-${suffix}`;
};

/**
 * Inicializa la cola y el listener de finalización. No-op si SANDBOX está deshabilitado.
 * @param {object} [io] - Instancia de Socket.IO (opcional; también se puede setear con setSandboxIO).
 * @returns {void}
 */
export const initSandboxQueue = (io) => {
    if (io) ioInstance = io;
    if (!SANDBOX.enabled) {
        console.log('⚠️ [SANDBOX] deshabilitado (SANDBOX_ENABLED != true)');
        return;
    }
    try {
        const connection = getRedisConfig();
        const name = getQueueName();
        // Cola de encolado de jobs (el worker remoto los consume).
        queue = new Queue(name, { connection, defaultJobOptions: { removeOnComplete: 30, removeOnFail: 50, attempts: 1 } });
        queue.on('error', (err) => console.warn('⚠️ [SANDBOX] Queue error:', err.message));
        // Listener de eventos: cuando un job termina, persistimos/reaccionamos al resultado.
        queueEvents = new QueueEvents(name, { connection });
        queueEvents.on('error', (err) => console.warn('⚠️ [SANDBOX] QueueEvents error:', err.message));
        queueEvents.on('completed', async ({ returnvalue }) => {
            try {
                const data = typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
                if (data?.itemId) await handleSandboxResult(data);
            } catch (err) {
                console.error('❌ [SANDBOX] handler completed:', err.message);
            }
        });
        queueEvents.on('failed', ({ failedReason }) => console.error('❌ [SANDBOX] job falló:', failedReason));
        console.log(`✅ [SANDBOX] Cola lista (${name}); el worker corre en VM-Sandbox`);
    } catch (err) {
        console.warn('⚠️ [SANDBOX] init falló:', err.message);
    }
};

/**
 * Encola un job de ejecución en sandbox.
 * @param {number|string} itemId - ID del recurso a analizar (interpretado por el handler).
 * @param {string} repoUrl - URL del repo / fuente a ejecutar en el sandbox.
 * @returns {Promise<boolean>} true si se encoló; false si la cola no está disponible.
 */
export const enqueueSandbox = async (itemId, repoUrl) => {
    if (!queue) return false;
    try {
        await queue.add('run', { itemId, repoUrl });
        return true;
    } catch (err) {
        console.warn('⚠️ [SANDBOX] enqueue falló:', err.message);
        return false;
    }
};

/**
 * Procesa el resultado de un job terminado delegando en el handler registrado (si hay).
 * Sin handler, emite `sandbox:completed` genérico.
 * @param {object} result - Resultado devuelto por el worker.
 * @param {number|string} result.itemId - ID del recurso analizado.
 * @param {object} result.sandbox - Payload de resultado de la ejecución.
 * @returns {Promise<void>}
 */
const handleSandboxResult = async ({ itemId, sandbox }) => {
    // Delegamos la persistencia/reacción al handler registrado por el módulo dueño.
    const handler = getSandboxResultHandler();
    if (handler) {
        await handler({ itemId, sandbox, models: getModels(), db, io: ioInstance });
    } else if (ioInstance) {
        // Sin handler: notificación genérica para que el cliente sepa que terminó.
        ioInstance.to('app').emit('sandbox:completed', { itemId, sandbox });
    }
    console.log(`🏖️ [SANDBOX] item ${itemId} → ${sandbox?.verdict ?? 'done'}`);
};
