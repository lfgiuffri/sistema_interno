import { test, expect } from '../../fixtures/auth.fixture';
import { AUTH_ENDPOINTS, ADMIN_USERNAME, ADMIN_PASSWORD, FIXTURE_USER } from '../../helpers/constants';
import { expectSuccess, expectError, expectAuthResponse } from '../../helpers/response';

/**
 * M1 — Autenticación (single-tenant).
 * signin (ok / credenciales malas / validación), refresh y contexto de sesión (/me, my-account).
 *
 * Nota lockout: los fallos de login cuentan para el bloqueo (5 por usuario+IP en 15 min).
 * Un login exitoso del mismo usuario/IP limpia los fallos, así que esta suite queda
 * muy por debajo del umbral en una corrida normal.
 */
test.describe('M1: Autenticación', () => {
  test('M1.1 - signin admin OK → tokens + user', async ({ unauthApi }) => {
    const res = await unauthApi.post(AUTH_ENDPOINTS.signin, {
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    const body = await expectSuccess(res, 200);
    expectAuthResponse(body.data);
    expect(body.data).toHaveProperty('user');
    expect(body.data.user).toHaveProperty('username', ADMIN_USERNAME);
  });

  test('M1.2 - signin del usuario de fixture OK (acepta username o email)', async ({ unauthApi }) => {
    const res = await unauthApi.post(AUTH_ENDPOINTS.signin, {
      data: { username: FIXTURE_USER.email, password: FIXTURE_USER.password },
    });
    const body = await expectSuccess(res, 200);
    expectAuthResponse(body.data);
    expect(body.data.user).toHaveProperty('username', FIXTURE_USER.username);
  });

  test('M1.3 - signin con password incorrecto → 401 genérico', async ({ unauthApi }) => {
    const res = await unauthApi.post(AUTH_ENDPOINTS.signin, {
      data: { username: ADMIN_USERNAME, password: 'password-incorrecto-xyz' },
    });
    const body = await expectError(res, 401);
    // Anti-enumeración: mismo mensaje para usuario inexistente y password malo.
    expect(body.message).toContain('Credenciales');
  });

  test('M1.4 - signin con usuario inexistente → 401 (mismo mensaje)', async ({ unauthApi }) => {
    const res = await unauthApi.post(AUTH_ENDPOINTS.signin, {
      data: { username: 'no-existe-zzz@nope.test', password: 'whatever123' },
    });
    const body = await expectError(res, 401);
    expect(body.message).toContain('Credenciales');
  });

  test('M1.5 - signin sin password → 422 (validación)', async ({ unauthApi }) => {
    const res = await unauthApi.post(AUTH_ENDPOINTS.signin, {
      data: { username: ADMIN_USERNAME },
    });
    await expectError(res, 422);
  });

  test('M1.6 - refresh con refreshToken válido → nuevos tokens', async ({ unauthApi, tokens }) => {
    const res = await unauthApi.post(AUTH_ENDPOINTS.refresh, {
      data: { refreshToken: tokens.refreshToken },
    });
    const body = await expectSuccess(res, 200);
    expect(body.data).toHaveProperty('accessToken');
    expect(body.data).toHaveProperty('refreshToken');
  });

  test('M1.7 - refresh sin token → 401', async ({ unauthApi }) => {
    const res = await unauthApi.post(AUTH_ENDPOINTS.refresh, { data: {} });
    await expectError(res, 401);
  });

  test('M1.8 - GET /me → contexto de sesión (user + modules + capabilities)', async ({ authedApi }) => {
    const res = await authedApi.get(AUTH_ENDPOINTS.me);
    const body = await expectSuccess(res, 200);
    expect(body.data).toHaveProperty('user');
    expect(body.data).toHaveProperty('modules');
    expect(body.data).toHaveProperty('capabilities');
    expect(body.data).toHaveProperty('declaredCapabilities');
    expect(Array.isArray(body.data.modules)).toBeTruthy();
    expect(body.data.user).toHaveProperty('email');
  });

  test('M1.9 - GET /users/my-account → 200 (sin capability: es la cuenta propia)', async ({ authedApi }) => {
    const res = await authedApi.get(AUTH_ENDPOINTS.myAccount);
    const body = await expectSuccess(res, 200);
    expect(body.data).toHaveProperty('user');
  });

  test('M1.10 - GET /me sin token → 401', async ({ unauthApi }) => {
    const res = await unauthApi.get(AUTH_ENDPOINTS.me);
    await expectError(res, 401);
  });

  test('M1.11 - GET /auth/mfa/status → { mfaEnabled: false } por defecto', async ({ authedApi }) => {
    const res = await authedApi.get(AUTH_ENDPOINTS.mfaStatus);
    const body = await expectSuccess(res, 200);
    expect(body.data).toHaveProperty('mfaEnabled', false);
  });
});
