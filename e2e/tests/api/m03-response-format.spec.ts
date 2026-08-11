import { test, expect } from '../../fixtures/auth.fixture';
import { AUTH_ENDPOINTS, APP_ENDPOINTS, ADMIN_USERNAME, ADMIN_PASSWORD } from '../../helpers/constants';
import { expectISO8601 } from '../../helpers/response';

/**
 * M3 — Formato de respuesta (envelope homogéneo).
 * Todas las respuestas: { success, code, message, timestamp, data?, meta? }.
 */
test.describe('M3: Formato de respuesta', () => {
  test('M3.1 - respuesta de éxito tiene envelope completo', async ({ unauthApi }) => {
    const res = await unauthApi.post(AUTH_ENDPOINTS.signin, {
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('code', 200);
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('data');
    expectISO8601(body.timestamp);
  });

  test('M3.2 - respuesta de error tiene envelope completo', async ({ unauthApi }) => {
    const res = await unauthApi.get(APP_ENDPOINTS.areas); // 401 sin token
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('success', false);
    expect(body).toHaveProperty('code', 401);
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.message).toBe('string');
    expectISO8601(body.timestamp);
  });

  test('M3.3 - el código del body coincide con el status HTTP', async ({ unauthApi }) => {
    const res = await unauthApi.post(AUTH_ENDPOINTS.signin, { data: { username: 'x' } }); // 422
    const body = await res.json();
    expect(body.code).toBe(res.status());
  });

  test('M3.4 - listado de áreas incluye meta de paginación', async ({ authedApi }) => {
    const res = await authedApi.get(`${APP_ENDPOINTS.areas}?page=1&limit=5`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('meta');
  });
});
