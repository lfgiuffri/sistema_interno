import 'dotenv/config'
import * as Sentry from '@sentry/node';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import app from "./app.js";
import { initDatabase } from './database.js';
import { setSchedulerIO, initSchedulerQueue, startScheduler } from './services/scheduler/services/scheduler.service.js';
import { registerSchedulerHandler } from './kernel/handlerRegistry.js';
import { avisosHandler } from './services/avisos/avisos.handler.js';
import { gcHandler } from './services/avisos/gc.handler.js';
import { monitoreoHandler } from './modules/mantenimiento/services/monitoreo.handler.js';
import { sitiosHandler } from './modules/mantenimiento/services/sitios.handler.js';
import { setSandboxIO, initSandboxQueue } from './services/sandbox/services/sandboxQueue.service.js';
import { registerSocketHandlers } from './socket/socketHandlers.js';
import { mountFeatureModules } from './routes.js';
import { registerPresence } from './kernel/realtime/presence.js';
import { runMigrations } from './kernel/migrations/migrationRunner.js';

// Fail-fast: sin JWT_SECRET no se pueden firmar/verificar tokens de forma segura (un secreto
// vacío haría que jwt acepte/firme con clave trivial). Abortamos antes de levantar el server.
if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
    console.error('❌ JWT_SECRET no está configurado. Definilo en .env antes de arrancar.');
    process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
    console.warn('⚠️ JWT_SECRET es corto (<32 chars). En producción usá un secreto largo y aleatorio.');
}

// Registrar el handler de presence/broadcast (se aplica a cada conexión de socket autenticada).
registerPresence();

const port = process.env.PORT || 3000;

// Crear server HTTP y adjuntar Socket.IO
const server = http.createServer(app);

const io = new SocketIOServer(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST']
    },
    // Permitir payloads multimodales (imágenes base64) hasta 10MB.
    maxHttpBufferSize: 10 * 1024 * 1024
});

// Autenticación de sockets vía JWT (mismo access token de la API).
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token provided'));
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'access') return next(new Error('Invalid token'));
        socket.userId = decoded.id;
        // Guardar exp para desconexión por TTL
        socket.tokenExp = decoded.exp;
        next();
    } catch (err) {
        next(new Error('Invalid token'));
    }
});

io.on('connection', (socket) => {
    // Room personal del usuario (para notificaciones dirigidas) + room global de la app
    // (para broadcasts a todos los conectados).
    socket.join(`user:${socket.userId}`);
    socket.join('app');
    console.log(`🔌 Socket connected: user ${socket.userId}`);

    // Desconectar cuando el token expire
    if (socket.tokenExp) {
        const ttlMs = (socket.tokenExp * 1000) - Date.now();
        if (ttlMs > 0) {
            socket._tokenTimer = setTimeout(() => {
                console.log(`⏰ Socket desconectado por token expirado: user ${socket.userId}`);
                socket.emit('auth:expired');
                socket.disconnect(true);
            }, ttlMs);
        } else {
            socket.disconnect(true);
            return;
        }
    }

    // Registrar handlers de socket aportados por los módulos (presencia, chat, etc.).
    registerSocketHandlers(socket, io);

    socket.on('disconnect', () => {
        if (socket._tokenTimer) clearTimeout(socket._tokenTimer);
        console.log(`🔌 Socket disconnected: user ${socket.userId}`);
    });
});

// Exponer io para que el middleware de app.js (montado antes de las rutas) setee req.io.
app.set('io', io);

// Pasar io a los servicios que emiten eventos en tiempo real.
setSchedulerIO(io);
setSandboxIO(io);

/**
 * Arranca el servidor: inicializa la base (conexión + modelos + migraciones), monta los
 * módulos feature, inicializa colas (BullMQ/Redis) y el scheduler, y escucha.
 * @returns {Promise<void>}
 */
const startServer = async () => {
    // Conexión única + modelos (auto-discovery). Aborta si la base no responde.
    try {
        await initDatabase();
        console.log('✅ Base de datos conectada y modelos inicializados');
    } catch (err) {
        console.error('❌ Error inicializando la base de datos:', err.message);
        console.error('💡 Ejecutá primero: npm run init_db');
        process.exit(1);
    }

    // Migraciones pendientes al boot (idempotentes). Desactivable con AUTO_MIGRATE=false.
    if (process.env.AUTO_MIGRATE !== 'false') {
        const { applied } = await runMigrations();
        if (applied.length) console.log(`✅ Migraciones aplicadas al boot: ${applied.join(', ')}`);
    }

    // Descubrir y montar los módulos feature (manifest + auto-discovery) ANTES de escuchar.
    await mountFeatureModules();

    // Handler de errores de Express para observabilidad (Sentry/GlitchTip). Debe ir DESPUÉS de
    // montar todas las rutas. No-op si no hay SENTRY_DSN (instrument.mjs no inicializó el SDK).
    if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

    // Inicializar BullMQ scheduler (fallback a setInterval si Redis no está disponible).
    await initSchedulerQueue();

    // Inicializar cola de sandbox (el worker corre aparte; acá encolamos + reaccionamos al resultado).
    initSandboxQueue(io);

    // Avisos diarios (abonos por actualizar + tareas por vencer) — mejora PRD §10.7.
    registerSchedulerHandler(avisosHandler);
    // GC diario de archivos huérfanos de tareas — mejora PRD §6.6.
    registerSchedulerHandler(gcHandler);
    // Monitoreo de servidores: caídas por heartbeat, chequeo TCP de los de terceros y
    // consolidación diaria de métricas. Corre siempre, haya o no gente usando la app.
    registerSchedulerHandler(monitoreoHandler);
    // Monitoreo de sitios web: disponibilidad cada 5 minutos, dominios y certificados.
    registerSchedulerHandler(sitiosHandler);

    // Arrancar el scheduler de la app (tick por minuto; corre los handlers de los módulos).
    await startScheduler();

    server.listen(port);
    console.log(`🚀 Sistema Interno corriendo en puerto ${port}`);
};

startServer().catch((err) => {
    console.error('❌ Error iniciando servidor:', err);
    process.exit(1);
});
