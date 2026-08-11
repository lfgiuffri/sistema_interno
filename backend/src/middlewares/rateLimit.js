import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis, isRedisAvailable } from '../config/redis.js';

const isDev = process.env.NODE_ENV !== 'production';

// Middleware passthrough para desarrollo (no limita nada)
const noopLimiter = (req, res, next) => next();

// Valores desde .env con defaults razonables
const globalWindowMs = parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS) || 15 * 60 * 1000;
const globalMax = parseInt(process.env.RATE_LIMIT_GLOBAL_MAX) || 1000;
const authWindowMs = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 15 * 60 * 1000;
const authMax = parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10;

/**
 * Create Redis store for rate limiting if Redis is available.
 */
const createRedisStore = (prefix) => {
    const client = getRedis();
    if (!client || !isRedisAvailable()) return undefined;

    return new RedisStore({
        sendCommand: (...args) => client.call(...args),
        prefix: `rl:${prefix}:`,
    });
};

// Rate limiter global — protección anti-DDoS básica
export const globalRateLimit = isDev ? noopLimiter : rateLimit({
    windowMs: globalWindowMs,
    max: globalMax,
    message: {
        success: false,
        code: 429,
        error: 'RATE_LIMIT',
        message: 'Demasiadas solicitudes, intenta de nuevo más tarde.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    store: createRedisStore('global'),
});

// Rate limiter para auth — anti brute-force
export const authRateLimit = isDev ? noopLimiter : rateLimit({
    windowMs: authWindowMs,
    max: authMax,
    message: {
        success: false,
        code: 429,
        error: 'RATE_LIMIT_AUTH',
        message: 'Demasiados intentos de autenticación, intenta de nuevo más tarde.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skipFailedRequests: false,
    store: createRedisStore('auth'),
});
