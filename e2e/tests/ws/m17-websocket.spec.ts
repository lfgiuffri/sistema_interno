import { test, expect } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { API_BASE, BACKEND_URL, AUTH_ENDPOINTS, FIXTURE_USER } from '../../helpers/constants';

/**
 * M17 — WebSocket (Socket.IO): conexión autenticada + presencia básica.
 *
 * El server (index.js) autentica el socket por JWT en handshake.auth.token y une la conexión
 * al room del tenant; el handler de presencia (presence.js) emite `presence:join` y responde
 * `presence:list` por ack. Sin token, la conexión es rechazada.
 */

/** Login del admin del tenant de fixture → accessToken para el handshake del socket. */
async function getFixtureToken(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE}/${AUTH_ENDPOINTS.signin}`, {
    data: { username: FIXTURE_USER.username, password: FIXTURE_USER.password },
  });
  const body = await res.json();
  return (body.data || body).accessToken;
}

/** Promesa de un evento del socket con timeout (sin waitForTimeout). */
function waitForEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout esperando '${event}'`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test.describe('M17: WebSocket', () => {
  test('M17.1 - conexión con token válido → connect', async ({ request }) => {
    const token = await getFixtureToken(request);
    const socket = io(BACKEND_URL, { auth: { token }, transports: ['websocket'], reconnection: false });
    try {
      await waitForEvent(socket, 'connect');
      expect(socket.connected).toBe(true);
    } finally {
      socket.disconnect();
    }
  });

  test('M17.2 - conexión sin token → connect_error', async () => {
    const socket = io(BACKEND_URL, { auth: {}, transports: ['websocket'], reconnection: false });
    try {
      const err = await waitForEvent<Error>(socket, 'connect_error');
      expect(err).toBeDefined();
      expect(socket.connected).toBe(false);
    } finally {
      socket.disconnect();
    }
  });

  test('M17.3 - presence:list responde por ack con la lista online', async ({ request }) => {
    const token = await getFixtureToken(request);
    const socket = io(BACKEND_URL, { auth: { token }, transports: ['websocket'], reconnection: false });
    try {
      await waitForEvent(socket, 'connect');
      const ack = await new Promise<{ online: unknown[] }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout en presence:list ack')), 10_000);
        socket.emit('presence:list', (res: { online: unknown[] }) => {
          clearTimeout(timer);
          resolve(res);
        });
      });
      expect(ack).toHaveProperty('online');
      expect(Array.isArray(ack.online)).toBeTruthy();
    } finally {
      socket.disconnect();
    }
  });

  test('M17.4 - broadcast:subscribe responde ok por ack', async ({ request }) => {
    const token = await getFixtureToken(request);
    const socket = io(BACKEND_URL, { auth: { token }, transports: ['websocket'], reconnection: false });
    try {
      await waitForEvent(socket, 'connect');
      const ack = await new Promise<{ ok: boolean; channel?: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout en broadcast:subscribe ack')), 10_000);
        socket.emit('broadcast:subscribe', { channel: 'e2e-channel' }, (res: { ok: boolean; channel?: string }) => {
          clearTimeout(timer);
          resolve(res);
        });
      });
      expect(ack.ok).toBe(true);
      expect(ack.channel).toBe('e2e-channel');
    } finally {
      socket.disconnect();
    }
  });
});
