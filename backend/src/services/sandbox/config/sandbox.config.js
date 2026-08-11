import 'dotenv/config';

const int = (name, fallback) => {
    const v = parseInt(process.env[name], 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Configuración del sandbox de ejecución (corre código no confiable bajo gVisor).
 * Default OFF — habilitar con SANDBOX_ENABLED=true.
 */
export const SANDBOX = {
    enabled: process.env.SANDBOX_ENABLED === 'true',
    dockerBin: process.env.SANDBOX_DOCKER_BIN || 'docker',
    runtime: process.env.SANDBOX_RUNTIME || 'runsc', // gVisor
    workRoot: process.env.SANDBOX_WORK_ROOT || '/tmp/zero-sandbox',
    nodeImage: process.env.SANDBOX_NODE_IMAGE || 'node:20-bookworm-slim',
    pythonImage: process.env.SANDBOX_PYTHON_IMAGE || 'python:3.12-slim',
    goImage: process.env.SANDBOX_GO_IMAGE || 'golang:1.22-bookworm',
    cloneTimeoutMs: int('SANDBOX_CLONE_TIMEOUT_MS', 120000),
    buildTimeoutMs: int('SANDBOX_BUILD_TIMEOUT_MS', 180000),
    runTimeoutMs: int('SANDBOX_RUN_TIMEOUT_MS', 45000),
    memory: process.env.SANDBOX_MEMORY || '1g',
    cpus: process.env.SANDBOX_CPUS || '1',
    pidsLimit: int('SANDBOX_PIDS_LIMIT', 256),
    maxLogChars: int('SANDBOX_MAX_LOG_CHARS', 12000),
    maxRepoMb: int('SANDBOX_MAX_REPO_MB', 200),
    // Instalar dependencias requiere red. Se hace con scripts deshabilitados y caps mínimas.
    allowDepFetch: process.env.SANDBOX_ALLOW_DEP_FETCH !== 'false', // default true en el host sandbox aislado
};
