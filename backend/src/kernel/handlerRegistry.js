/**
 * Sistema Interno — Registro central de handlers pluggable.
 *
 * Los frameworks genéricos del core (scheduler, sockets, notification-actions,
 * sandbox) NO conocen ningún dominio: iteran sobre handlers que los módulos
 * registran acá. Con cero módulos de dominio cargados, los registros quedan
 * vacíos y los frameworks corren como no-ops.
 *
 * El sistema de modularidad (manifest + auto-discovery) llama a estas funciones
 * `register*` al cargar cada módulo. Ver docs/modularity.md.
 */

// ─── Scheduler ────────────────────────────────────────────────────────────────
// handler = { name, run({ tenantId, tenantDb, models, io }) }
// Corre en cada tick del scheduler por tenant (default cada 60s).
const schedulerHandlers = [];

export const registerSchedulerHandler = (handler) => {
    if (!handler || typeof handler.run !== 'function') {
        throw new Error('registerSchedulerHandler: se requiere { name, run(ctx) }');
    }
    schedulerHandlers.push(handler);
    return handler;
};

export const getSchedulerHandlers = () => schedulerHandlers.slice();

// ─── Socket.IO ──────────────────────────────────────────────────────────────
// handler = (socket, io) => void  — registra los socket.on(...) del módulo.
// Se invoca una vez por cada conexión de socket autenticada.
const socketHandlers = [];

export const registerSocketHandler = (handler) => {
    if (typeof handler !== 'function') {
        throw new Error('registerSocketHandler: se requiere una función (socket, io)');
    }
    socketHandlers.push(handler);
    return handler;
};

export const getSocketHandlers = () => socketHandlers.slice();

// ─── Notification actions ──────────────────────────────────────────────────
// handler = { match(value): boolean, run({ tenantId, userId, value, models, io, room }): Promise<result> }
// Dispatch de quick-replies firmadas (push / chat). El primero que matchea, ejecuta.
const notificationActionHandlers = [];

export const registerNotificationAction = (handler) => {
    if (!handler || typeof handler.match !== 'function' || typeof handler.run !== 'function') {
        throw new Error('registerNotificationAction: se requiere { match(value), run(ctx) }');
    }
    notificationActionHandlers.push(handler);
    return handler;
};

export const getNotificationActionHandlers = () => notificationActionHandlers.slice();

// ─── Sandbox result ──────────────────────────────────────────────────────────
// handler = ({ tenantId, dbName, itemId, sandbox, models, db, io }) => Promise<void>
// Persiste/reacciona al resultado de un job de sandbox. Solo uno (el último gana).
let sandboxResultHandler = null;

export const setSandboxResultHandler = (handler) => {
    if (handler != null && typeof handler !== 'function') {
        throw new Error('setSandboxResultHandler: se requiere una función o null');
    }
    sandboxResultHandler = handler;
};

export const getSandboxResultHandler = () => sandboxResultHandler;

// ─── Reset (tests) ───────────────────────────────────────────────────────────
export const __resetHandlers = () => {
    schedulerHandlers.length = 0;
    socketHandlers.length = 0;
    notificationActionHandlers.length = 0;
    sandboxResultHandler = null;
};
