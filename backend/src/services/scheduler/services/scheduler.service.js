import { Queue, Worker } from 'bullmq';
import { getRedisConfig, pingRedis } from '../../../config/redis.js';
import { db, getModels } from '../../../database.js';
import { getSchedulerHandlers } from '../../../kernel/handlerRegistry.js';

/**
 * Scheduler genérico (single-tenant).
 * Usa un job repetible de BullMQ cuando Redis está disponible; cae a setInterval si no.
 * NO conoce ningún dominio: en cada tick ejecuta los handlers que los módulos
 * registraron vía registerSchedulerHandler (ver kernel/handlerRegistry.js).
 * handler = { name, run({ db, models, io }) }
 */

const JOB_ID = 'scheduler:app';
const TICK_MS = 60 * 1000;

let started = false;
let fallbackInterval = null;
let fallbackRunning = false;
let runningJobStartedAt = null;
let ioInstance = null;

// Instancias de BullMQ
let schedulerQueue = null;
let schedulerWorker = null;
let usingBullMQ = false;

/**
 * Lee un entero de entorno con fallback (solo valores positivos).
 * @param {string} name - Variable de entorno.
 * @param {number} fallback - Valor por defecto.
 * @returns {number} El valor parseado o el fallback.
 */
const parseSchedulerInt = (name, fallback) => {
    const value = parseInt(process.env[name], 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Nombre de la cola (aislado por instalación para no chocar entre despliegues que
 * compartan Redis).
 * @returns {string} Nombre de la cola BullMQ.
 */
const getSchedulerQueueName = () => {
    if (process.env.SCHEDULER_QUEUE_NAME) return process.env.SCHEDULER_QUEUE_NAME;
    const source = process.env.SCHEDULER_QUEUE_SUFFIX
        || process.env.PUBLIC_API_URL
        || process.env.DB_NAME
        || process.env.PORT
        || 'default';
    const suffix = String(source)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'default';
    return `si-scheduler-${suffix}`;
};

/**
 * Ejecuta los handlers registrados. Sin handlers → no-op.
 * Cada handler se aísla: si uno tira error, los demás siguen.
 * @returns {Promise<void>}
 */
const runScheduledJobs = async () => {
    const handlers = getSchedulerHandlers();
    for (const handler of handlers) {
        try {
            await handler.run({ db, models: getModels(), io: ioInstance });
        } catch (err) {
            console.error(`❌ [SCHEDULER] Handler "${handler.name || 'anon'}":`, err.message);
        }
    }
};

/**
 * Corre un tick con lock in-process: si el tick anterior sigue corriendo se saltea,
 * y un lock stale (proceso colgado) se libera para no congelar el scheduler.
 * @returns {Promise<void>}
 */
const runScheduledJobsGuarded = async () => {
    if (runningJobStartedAt) {
        const staleMs = parseSchedulerInt('SCHEDULER_LOCK_STALE_MS', 10 * 60 * 1000);
        const ageMs = Date.now() - runningJobStartedAt;
        if (ageMs < staleMs) {
            console.warn('⏭️ [SCHEDULER] El tick anterior todavía está corriendo; se saltea este');
            return;
        }
        console.warn(`🧹 [SCHEDULER] Lock stale (${ageMs}ms); se libera para no congelar el scheduler.`);
    }
    const startedAt = Date.now();
    runningJobStartedAt = startedAt;
    try {
        const warnMs = parseSchedulerInt('SCHEDULER_JOB_WARN_MS', 55 * 1000);
        await runScheduledJobs();
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > warnMs) {
            console.warn(`⚠️ [SCHEDULER] El tick tardó ${elapsedMs}ms.`);
        }
    } finally {
        if (runningJobStartedAt === startedAt) runningJobStartedAt = null;
    }
};

/**
 * Setea la instancia de Socket.IO para que los handlers emitan eventos real-time.
 * @param {object} io - Instancia de Socket.IO.
 * @returns {void}
 */
export const setSchedulerIO = (io) => {
    ioInstance = io;
};

/**
 * Devuelve la instancia de Socket.IO del scheduler (o null).
 * @returns {object|null} io.
 */
export const getSchedulerIO = () => ioInstance;

/**
 * Inicializa la cola + worker de BullMQ. Se llama una vez al boot.
 * Si Redis no está disponible, no hace nada (fallback a setInterval en startScheduler).
 * @returns {Promise<void>}
 */
export const initSchedulerQueue = async () => {
    const available = await pingRedis();
    if (!available) {
        console.log('⚠️ [SCHEDULER] Redis no disponible, usando setInterval como fallback');
        usingBullMQ = false;
        return;
    }

    try {
        const connection = getRedisConfig();
        const queueName = getSchedulerQueueName();

        schedulerQueue = new Queue(queueName, {
            connection,
            defaultJobOptions: {
                removeOnComplete: 10,
                removeOnFail: 5,
            },
        });

        // Sin este handler, un fallo de conexión de la Queue emite un 'error' no
        // capturado que tira el proceso (el Worker ya tiene el suyo).
        schedulerQueue.on('error', (err) => {
            console.error('❌ [SCHEDULER] Queue error:', err.message);
        });

        schedulerWorker = new Worker(queueName, async () => {
            try {
                await runScheduledJobsGuarded();
            } catch (err) {
                console.error('❌ [SCHEDULER] BullMQ job error:', err.message);
                throw err; // BullMQ maneja el retry
            }
        }, {
            connection,
            concurrency: 1,
            lockDuration: parseSchedulerInt('SCHEDULER_LOCK_DURATION_MS', 10 * 60 * 1000),
            lockRenewTime: parseSchedulerInt('SCHEDULER_LOCK_RENEW_TIME_MS', 30 * 1000),
            stalledInterval: parseSchedulerInt('SCHEDULER_STALLED_INTERVAL_MS', 60 * 1000),
            maxStalledCount: parseSchedulerInt('SCHEDULER_MAX_STALLED_COUNT', 2),
        });

        schedulerWorker.on('failed', (job, err) => {
            console.error(`❌ [SCHEDULER] Job ${job?.id} failed:`, err.message);
        });
        schedulerWorker.on('error', (err) => {
            console.error('❌ [SCHEDULER] Worker error:', err.message);
        });

        usingBullMQ = true;
        console.log(`✅ [SCHEDULER] BullMQ scheduler inicializado (${queueName})`);
    } catch (err) {
        console.warn('⚠️ [SCHEDULER] Error inicializando BullMQ, usando setInterval:', err.message);
        usingBullMQ = false;
    }
};

/**
 * Arranca el scheduler de la app (idempotente): job repetible de BullMQ si hay Redis,
 * setInterval si no. Corre un tick inmediato al arrancar.
 * @returns {Promise<void>}
 */
export const startScheduler = async () => {
    if (started) return;

    if (usingBullMQ && schedulerQueue) {
        try {
            await schedulerQueue.add('tick', {}, {
                repeat: { every: TICK_MS },
                jobId: JOB_ID,
            });
            started = true;
            console.log('✅ [SCHEDULER] Job repetible de BullMQ registrado');
        } catch (err) {
            console.warn('⚠️ [SCHEDULER] BullMQ add falló, fallback setInterval:', err.message);
            startFallbackInterval();
        }
    } else {
        startFallbackInterval();
    }

    // Primer tick inmediato (los avisos no esperan un minuto tras el deploy).
    runScheduledJobsGuarded().catch(err => {
        console.error('❌ [SCHEDULER] Error en el tick inicial:', err.message);
    });
};

/**
 * Fallback: tick por setInterval cuando Redis/BullMQ no está disponible.
 * @returns {void}
 */
const startFallbackInterval = () => {
    if (started) return;
    fallbackInterval = setInterval(async () => {
        if (fallbackRunning) {
            console.warn('⏭️ [SCHEDULER] Fallback todavía corriendo; se saltea este tick');
            return;
        }
        fallbackRunning = true;
        try {
            await runScheduledJobsGuarded();
        } catch (err) {
            console.error('❌ [SCHEDULER] Fallback error:', err.message);
        } finally {
            fallbackRunning = false;
        }
    }, TICK_MS);
    started = true;
    console.log('✅ [SCHEDULER] Fallback setInterval iniciado');
};

/**
 * Detiene el scheduler por completo (tests / shutdown limpio).
 * @returns {Promise<void>}
 */
export const stopScheduler = async () => {
    if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
    }
    fallbackRunning = false;
    runningJobStartedAt = null;

    if (schedulerWorker) {
        await schedulerWorker.close().catch(() => {});
        schedulerWorker = null;
    }
    if (schedulerQueue) {
        try {
            const repeatableJobs = await schedulerQueue.getRepeatableJobs();
            for (const job of repeatableJobs) {
                await schedulerQueue.removeRepeatableByKey(job.key);
            }
        } catch { /* ignore */ }
        await schedulerQueue.close().catch(() => {});
        schedulerQueue = null;
    }
    started = false;
    usingBullMQ = false;
    console.log('🛑 [SCHEDULER] Scheduler detenido');
};
