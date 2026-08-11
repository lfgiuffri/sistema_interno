/**
 * Sistema Interno — Realtime presence + broadcast (estilo Supabase Realtime, single-tenant).
 *
 * Sobre Socket.IO. Provee dos capacidades:
 *
 *  1. PRESENCIA: rastrea qué usuarios están online. El estado vive en memoria (no hay
 *     modelo ni persistencia): un Map `userId -> count`. El `count` soporta multi-tab /
 *     multi-dispositivo: recién emitimos `presence:leave` al cerrarse la última conexión.
 *
 *  2. BROADCAST: un cliente publica un mensaje en un "canal" lógico y se reenvía a todos
 *     los suscriptores. Room: `broadcast:<channel>`.
 *
 * IMPORTANTE: este archivo NO se importa desde index.js para los sockets. El orquestador
 * llama a `registerPresence()` en el boot; eso suma `presenceHandler` al handlerRegistry
 * y el core lo invoca una vez por cada conexión autenticada (ver socket/socketHandlers.js).
 *
 * Degradación: si el módulo no se registra, no pasa nada — el core corre sin presencia.
 * El estado en memoria se reinicia con el proceso (aceptable para presencia efímera).
 */

import { registerSocketHandler } from '../handlerRegistry.js';

/**
 * Estado de presencia en memoria, por proceso: Map<userId, conexionesAbiertas>.
 * Contador por userId (no un Set) para soportar multi-tab: el usuario sigue "online"
 * mientras tenga al menos una conexión viva; solo sale al llegar a 0.
 * @type {Map<string|number, number>}
 */
const connections = new Map();

/** Room que agrupa a TODAS las conexiones autenticadas de la app. */
const APP_ROOM = 'app';

/**
 * Room de un canal de broadcast.
 * @param {string} channel - Nombre lógico del canal elegido por el cliente.
 * @returns {string} Nombre del room (ej. "broadcast:chat").
 */
const broadcastRoom = (channel) => `broadcast:${channel}`;

/**
 * Marca una conexión nueva de un usuario en el estado de presencia.
 * @param {string|number} userId - Usuario que se conecta.
 * @returns {boolean} `true` si es la PRIMERA conexión (transición offline→online).
 */
const addConnection = (userId) => {
    const prev = connections.get(userId) || 0;
    connections.set(userId, prev + 1);
    return prev === 0;
};

/**
 * Quita una conexión de un usuario del estado de presencia.
 * @param {string|number} userId - Usuario que se desconecta.
 * @returns {boolean} `true` si era la ÚLTIMA conexión (transición online→offline).
 */
const removeConnection = (userId) => {
    const prev = connections.get(userId) || 0;
    if (prev <= 1) {
        connections.delete(userId);
        return prev === 1;
    }
    connections.set(userId, prev - 1);
    return false;
};

/**
 * Devuelve la lista de userIds actualmente online.
 * @returns {Array<string|number>} userIds online.
 */
const listOnline = () => [...connections.keys()];

/**
 * Handler de Socket.IO por conexión: instala los listeners de presencia y broadcast.
 * El core lo invoca una vez por cada socket recién autenticado (`socket.userId` ya seteado,
 * y el socket ya unido a `user:<id>` y al room global `app`).
 * @param {import('socket.io').Socket} socket - Socket autenticado (trae userId).
 * @param {import('socket.io').Server} io - Servidor Socket.IO (para emitir a rooms).
 * @returns {void}
 */
const presenceHandler = (socket, io) => {
    const { userId } = socket;

    // Defensa en profundidad: sin userId no hay presencia posible.
    if (userId == null) return;

    // Registrar la conexión y, si es la primera del usuario, avisar a todos.
    const isFirstConnection = addConnection(userId);
    if (isFirstConnection) {
        io.to(APP_ROOM).emit('presence:join', { userId, online: listOnline() });
    }

    // ── presence:list ─────────────────────────────────────────────────────────
    socket.on('presence:list', (ack) => {
        if (typeof ack === 'function') {
            ack({ online: listOnline() });
        }
    });

    // ── broadcast:subscribe ───────────────────────────────────────────────────
    socket.on('broadcast:subscribe', (data, ack) => {
        const channel = data?.channel;
        if (typeof channel !== 'string' || channel.length === 0) {
            if (typeof ack === 'function') ack({ ok: false, error: 'channel inválido' });
            return;
        }
        socket.join(broadcastRoom(channel));
        if (typeof ack === 'function') ack({ ok: true, channel });
    });

    // ── broadcast:unsubscribe ─────────────────────────────────────────────────
    socket.on('broadcast:unsubscribe', (data, ack) => {
        const channel = data?.channel;
        if (typeof channel !== 'string' || channel.length === 0) {
            if (typeof ack === 'function') ack({ ok: false, error: 'channel inválido' });
            return;
        }
        socket.leave(broadcastRoom(channel));
        if (typeof ack === 'function') ack({ ok: true, channel });
    });

    // ── broadcast:send ────────────────────────────────────────────────────────
    // Reenvía un payload a los suscriptores del canal. Incluye metadata del emisor
    // (from) para que los receptores sepan quién publicó, sin confiar en el payload.
    socket.on('broadcast:send', (data, ack) => {
        const channel = data?.channel;
        if (typeof channel !== 'string' || channel.length === 0) {
            if (typeof ack === 'function') ack({ ok: false, error: 'channel inválido' });
            return;
        }
        io.to(broadcastRoom(channel)).emit(`broadcast:${channel}`, {
            channel,
            from: userId,
            payload: data?.payload
        });
        if (typeof ack === 'function') ack({ ok: true });
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
        const wasLastConnection = removeConnection(userId);
        if (wasLastConnection) {
            io.to(APP_ROOM).emit('presence:leave', { userId, online: listOnline() });
        }
    });
};

/**
 * Registra el handler de presencia/broadcast en el handlerRegistry del kernel.
 * @returns {Function} El handler registrado.
 */
export const registerPresence = () => registerSocketHandler(presenceHandler);
