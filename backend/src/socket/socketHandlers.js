/**
 * Sistema Interno — Registro de handlers de Socket.IO por conexión (genérico, sin dominio).
 *
 * El core solo se ocupa de la conexión, la autenticación (en index.js) y el join al
 * room personal. Cualquier evento de aplicación (chat, presencia, etc.) lo aporta un
 * módulo registrando su factory vía registerSocketHandler (kernel/handlerRegistry.js).
 *
 * Sin handlers registrados, una conexión simplemente se une a su room y queda lista
 * para recibir emisiones del servidor (ej. eventos del scheduler).
 */

import { getSocketHandlers } from '../kernel/handlerRegistry.js';

/**
 * Aplica todos los handlers de socket registrados a una conexión recién establecida.
 * Se invoca una vez por cada socket autenticado (desde index.js, en io.on('connection')).
 * @param {import('socket.io').Socket} socket - El socket recién conectado (ya autenticado: trae tenantId/userId).
 * @param {import('socket.io').Server} io - La instancia del servidor Socket.IO.
 * @returns {void}
 */
export const registerSocketHandlers = (socket, io) => {
    for (const handler of getSocketHandlers()) {
        try {
            // Cada handler registra sus propios socket.on(...) sobre esta conexión.
            handler(socket, io);
        } catch (err) {
            // Un handler roto no debe tirar abajo la conexión ni los demás handlers.
            console.error('❌ [SOCKET] Error registrando handler de socket:', err.message);
        }
    }
};
