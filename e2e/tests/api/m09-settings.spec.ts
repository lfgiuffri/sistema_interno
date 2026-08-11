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
});
