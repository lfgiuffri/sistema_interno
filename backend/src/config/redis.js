import Redis from 'ioredis';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    retryStrategy(times) {
        if (times > 10) return null; // Stop after 10 retries
        return Math.min(times * 200, 5000);
    },
};

let redis = null;
let isAvailable = false;

/**
 * Get Redis connection (singleton, lazy).
 * Returns null if Redis not available.
 */
export const getRedis = () => {
    if (redis) return isAvailable ? redis : null;

    try {
        redis = new Redis(redisConfig);

        redis.on('connect', () => {
            isAvailable = true;
            console.log('� Redis conectado');
        });

        redis.on('error', (err) => {
            if (isAvailable) {
                console.warn('⚠️ Redis error:', err.message);
            }
            isAvailable = false;
        });

        redis.on('close', () => {
            isAvailable = false;
        });

        return redis;
    } catch {
        isAvailable = false;
        return null;
    }
};

/**
 * Get Redis config for BullMQ (creates new connection per worker).
 */
export const getRedisConfig = () => redisConfig;

/**
 * Probe Redis reachability with a bounded, no-retry connection.
 * Se usa para decidir BullMQ vs fallback sin crear una conexión que reintente
 * y spamee errores cuando Redis no está. No usa el singleton.
 * @param {number} [timeoutMs=1500] Presupuesto de conexión.
 * @returns {Promise<boolean>} true si respondió PONG; false si no hay Redis.
 */
export const pingRedis = async (timeoutMs = 1500) => {
    const probe = new Redis({
        ...redisConfig,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // un solo intento, sin reintentos
        connectTimeout: timeoutMs,
    });
    probe.on('error', () => {}); // swallow: el error se refleja en el catch
    try {
        await probe.connect();
        const pong = await probe.ping();
        return pong === 'PONG';
    } catch {
        return false;
    } finally {
        probe.disconnect();
    }
};

/**
 * Check if Redis is currently available.
 */
export const isRedisAvailable = () => isAvailable;

/**
 * Close Redis connection.
 */
export const closeRedis = async () => {
    if (redis) {
        await redis.quit().catch(() => {});
        redis = null;
        isAvailable = false;
    }
};

// --- Cache helpers ---

const DEFAULT_TTL = 300; // 5 minutes

/**
 * Get cached value from Redis. Falls back gracefully if Redis unavailable.
 */
export const cacheGet = async (key) => {
    const r = getRedis();
    if (!r) return null;
    try {
        const val = await r.get(key);
        return val ? JSON.parse(val) : null;
    } catch {
        return null;
    }
};

/**
 * Set cached value in Redis with TTL.
 */
export const cacheSet = async (key, value, ttlSeconds = DEFAULT_TTL) => {
    const r = getRedis();
    if (!r) return;
    try {
        await r.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch { /* graceful fallback */ }
};

/**
 * Delete cached key(s) from Redis.
 */
export const cacheDel = async (...keys) => {
    const r = getRedis();
    if (!r) return;
    try {
        await r.del(...keys);
    } catch { /* graceful fallback */ }
};

/**
 * Delete all keys matching a pattern (e.g., 'tenant:1:*').
 */
export const cacheDelPattern = async (pattern) => {
    const r = getRedis();
    if (!r) return;
    try {
        const keys = await r.keys(pattern);
        if (keys.length > 0) await r.del(...keys);
    } catch { /* graceful fallback */ }
};
