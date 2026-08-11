import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, AUTH_ENDPOINTS } from '../../helpers/constants';
import { expectError } from '../../helpers/response';

/**
 * M2 — Middlewares: autenticación / rate limit / lockout.
 *
 * Nota sobre rate limit: en desarrollo (NODE_ENV !== production) es un no-op por diseño.
 * El lockout (fuerza bruta) SÍ aplica siempre: 5 fallos por usuario+IP → 429.
 */
test.describe('M2: Middlewares', () => {
  test('M2.1 - areas sin token → 401', async ({ unauthApi }) => {
    const res = await unauthApi.get(APP_ENDPOINTS.areas);
    await expectError(res, 401);
  });

  test('M2.2 - GET /me sin token → 401', async ({ unauthApi }) => {
    const res = await unauthApi.get(APP_ENDPOINTS.me);
    await expectError(res, 401);
  });

  test('M2.3 - settings sin token → 401', async ({ unauthApi }) => {
    const res = await unauthApi.get(APP_ENDPOINTS.settings);
    await expectError(res, 401);
  });

  test('M2.4 - users sin token → 401', async ({ unauthApi }) => {
    const res = await unauthApi.get(APP_ENDPOINTS.users);
    await expectError(res, 401);
  });

  test('M2.5 - token inválido → 401', async ({ unauthApi }) => {
    const res = await unauthApi.get(APP_ENDPOINTS.areas, {
      headers: { 'x-access-token': 'header.invalido.jwt' },
    });
    await expectError(res, 401);
  });

  test('M2.6 - lockout: fallos repetidos del mismo usuario → 429 LOGIN_LOCKED', async ({ unauthApi }) => {
    // Usuario descartable: no colisiona con las credenciales reales de la suite.
    // Un login exitoso concurrente (otro worker) limpia los fallos de la IP, así que
    // en vez de contar exacto, insistimos hasta ver el 429 (con tope de intentos).
    const probe = `lockout-probe-${Date.now()}@nope.test`;
    let saw429 = false;
    for (let i = 0; i < 12 && !saw429; i++) {
      const res = await unauthApi.post(AUTH_ENDPOINTS.signin, {
        data: { username: probe, password: 'x'.repeat(12) },
      });
      expect([401, 429]).toContain(res.status());
      saw429 = res.status() === 429;
    }
    expect(saw429).toBeTruthy();
  });
});
