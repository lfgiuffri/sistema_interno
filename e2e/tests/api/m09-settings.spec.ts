import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';

/**
 * M9 — Settings (módulo de infra, preferencias del usuario; siempre disponible).
 */
test.describe('M9: Settings', () => {
  test('M9.1 - GET /settings → 200 (crea registro si no existe)', async ({ authedApi }) => {
    const res = await authedApi.get(APP_ENDPOINTS.settings);
    const body = await expectSuccess(res, 200);
    expect(body.data).toHaveProperty('userId');
  });

  test('M9.2 - PUT /settings → 200 actualiza preferencias', async ({ authedApi }) => {
    const res = await authedApi.put(APP_ENDPOINTS.settings, { data: { pushEnabled: false } });
    const body = await expectSuccess(res, 200);
    expect(body.data).toHaveProperty('userId');
  });

  test('M9.3 - GET /settings sin token → 401', async ({ unauthApi }) => {
    const res = await unauthApi.get(APP_ENDPOINTS.settings);
    await expectError(res, 401);
  });

  test('M9.4 - Web Push: la clave pública está publicada para que el navegador pueda suscribirse', async ({ authedApi }) => {
    const res = await authedApi.get(`${APP_ENDPOINTS.settings}/push/clave-publica`);
    const body = await expectSuccess(res, 200);
    // Sin clave, ningún navegador puede suscribirse: es el requisito de arranque.
    expect(typeof body.data.clavePublica).toBe('string');
    expect(body.data.clavePublica.length).toBeGreaterThan(80);
  });

  test('M9.5 - Web Push: alta y baja de la suscripción de un navegador', async ({ authedApi }) => {
    // Claves con el formato que entrega el navegador (no se validan criptográficamente acá:
    // eso lo hace la librería al enviar).
    const suscripcion = {
      endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}`,
      keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
    };

    await expectSuccess(await authedApi.post(`${APP_ENDPOINTS.settings}/push/suscripcion`, { data: suscripcion }), 201);
    // Re-suscribirse con el MISMO endpoint actualiza, no duplica (unicidad por endpoint).
    await expectSuccess(await authedApi.post(`${APP_ENDPOINTS.settings}/push/suscripcion`, { data: suscripcion }), 201);

    const baja = await authedApi.delete(`${APP_ENDPOINTS.settings}/push/suscripcion`, {
      data: { endpoint: suscripcion.endpoint },
    });
    expect((await expectSuccess(baja, 200)).data.borrada).toBe(true);
  });

  test('M9.6 - Web Push: una suscripción inválida → 422', async ({ authedApi }) => {
    await expectError(await authedApi.post(`${APP_ENDPOINTS.settings}/push/suscripcion`, {
      data: { endpoint: 'https://x', keys: { p256dh: '' } },
    }), 422);
  });

  test('M9.7 - probar sin dispositivos registrados explica QUÉ hacer, no solo que falló', async ({ authedApi }) => {
    const res = await authedApi.post(`${APP_ENDPOINTS.settings}/test-notification`);
    const body = await expectError(res, 400);
    // El mensaje tiene que ser accionable: antes decía «No hay token de push configurado»,
    // que no le dice nada a alguien que está en Chrome.
    expect(body.message).toMatch(/Configuración|activá|Activalas/i);
  });
});
