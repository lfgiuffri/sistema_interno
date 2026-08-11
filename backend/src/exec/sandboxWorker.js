import 'dotenv/config';
import { Worker } from 'bullmq';
import { getRedisConfig } from '../config/redis.js';
import { runSandbox } from '../services/sandbox/services/sandbox.service.js';

/**
 * Worker del sandbox — corre en VM-Sandbox (host aislado).
 * Consume jobs de la cola (Redis de VM-Zero), ejecuta el repo bajo gVisor y
 * DEVUELVE el resultado. NO accede a la base de datos ni a secrets (el backend persiste).
 *
 * Arranque: pm2 start src/exec/sandboxWorker.js --name sandbox-worker
 */

// Docker rootless: asegurar que execFile('docker') encuentre el daemon del usuario.
const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
process.env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
process.env.DOCKER_HOST = process.env.DOCKER_HOST || `unix:///run/user/${uid}/docker.sock`;
process.env.PATH = `/usr/bin:/usr/local/bin:${process.env.PATH || ''}`;

const getQueueName = () => {
    const source = process.env.SANDBOX_QUEUE_SUFFIX || process.env.MASTER_DBNAME || 'default';
    const suffix = String(source).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'default';
    return `zero-sandbox-${suffix}`;
};

const connection = getRedisConfig();
const name = getQueueName();

const worker = new Worker(name, async (job) => {
    const { tenantId, dbName, itemId, repoUrl } = job.data;
    console.log(`🔬 [SANDBOX-WORKER] ejecutando ${repoUrl} (item ${itemId})`);
    const sandbox = await runSandbox(repoUrl);
    return { tenantId, dbName, itemId, sandbox };
}, { connection, concurrency: parseInt(process.env.SANDBOX_MAX_CONCURRENCY) || 1, lockDuration: 10 * 60 * 1000 });

worker.on('completed', (job) => console.log(`✅ [SANDBOX-WORKER] ${job.data.repoUrl} → ${job.returnvalue?.sandbox?.verdict}`));
worker.on('failed', (job, err) => console.error(`❌ [SANDBOX-WORKER] ${job?.data?.repoUrl}:`, err.message));
worker.on('error', (err) => console.error('❌ [SANDBOX-WORKER] error:', err.message));

console.log(`🏖️ [SANDBOX-WORKER] escuchando cola "${name}" (concurrency ${worker.opts.concurrency})`);
