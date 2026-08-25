import { expect } from '@playwright/test';
// El fixture propio suma `adminApi`/`adminTokens`: M17.5 crea datos reales para provocar el evento.
import { test } from '../../fixtures/auth.fixture';
import { io, type Socket } from 'socket.io-client';
import { API_BASE, BACKEND_URL, AUTH_ENDPOINTS, FIXTURE_USER, APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

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

  /**
   * De este evento depende que las vistas de tareas —incluida **Análisis de tareas**— se
   * actualicen solas (`composables/useTareasEnVivo.ts` escucha `tarea:*` y `lista:*`). Si el
   * backend dejara de emitirlo, la pantalla quedaría mostrando números viejos sin avisar.
   */
  test('M17.5 - una mutación de tarea llega por socket a los demás (de esto vive el «en vivo»)', async ({ adminApi, adminTokens }) => {
    const socket = io(BACKEND_URL, { auth: { token: adminTokens.accessToken }, transports: ['websocket'], reconnection: false });
    const limpiar: string[] = [];
    try {
      await waitForEvent(socket, 'connect');

      const espacio = (await (await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('ZZ WS') })).json()).data;
      limpiar.push(`espacios/${espacio.id}`);
      const lista = (await (await adminApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacio.id}/listas`, {
        data: makeNombre('ZZ WS lista'),
      })).json()).data;

      // Alta: el evento tiene que llegar sin que el cliente pregunte nada.
      const creada = waitForEvent<{ id: number; listaId: number }>(socket, 'tarea:creada');
      const tarea = (await (await adminApi.post(APP_ENDPOINTS.tareas, {
        data: { listaId: lista.id, nombre: 'ZZ WS tarea' },
      })).json()).data;
      expect((await creada).id).toBe(tarea.id);

      // Cambio de estado: es el que mueve los números del análisis.
      const cambio = waitForEvent<{ id: number; estado: string }>(socket, 'tarea:estado');
      await adminApi.patch(`${APP_ENDPOINTS.tareas}/${tarea.id}/estado`, { data: { estado: 'completada' } });
      const payload = await cambio;
      expect(payload.id).toBe(tarea.id);
      expect(payload.estado).toBe('completada');
    } finally {
      socket.disconnect();
      for (const path of limpiar.reverse()) await hardDeleteByPath(path);
    }
  });
});
