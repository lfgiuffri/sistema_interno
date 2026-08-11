import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, AUTH_ENDPOINTS, FIXTURE_ROLE } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';

/**
 * M6 — Capabilities (deny-by-default).
 *
 * El usuario de fixture tiene un rol acotado (areas:* + usuarios:read). Verifica que:
 *  - /me expone exactamente sus capabilities.
 *  - Lo permitido responde 200 y lo no otorgado corta con 403 y el nombre de la capability.
 *  - El admin (comodín `*`) pasa por todo.
 */
test.describe('M6: Capabilities', () => {
  test('M6.1 - /me del fixture expone las capabilities de su rol', async ({ authedApi }) => {
    const res = await authedApi.get(AUTH_ENDPOINTS.me);
    const body = await expectSuccess(res, 200);
    const caps: string[] = body.data.capabilities || [];
    for (const cap of FIXTURE_ROLE.capabilities) {
      expect(caps).toContain(cap);
    }
    expect(caps).not.toContain('*');
  });

  test('M6.2 - capability otorgada: fixture puede listar usuarios (usuarios:read)', async ({ authedApi }) => {
    const res = await authedApi.get(APP_ENDPOINTS.users);
    await expectSuccess(res, 200);
  });

  test('M6.3 - capability NO otorgada: crear usuario → 403 con la capability faltante', async ({ authedApi }) => {
    const res = await authedApi.post(APP_ENDPOINTS.users, {
      data: { name: 'X', lastName: 'X', email: 'x@x.test', username: 'x-denied', password: 'Password123', roleId: 1 },
    });
    const body = await expectError(res, 403);
    expect(body.message).toContain('usuarios:create');
  });

  test('M6.4 - capability NO otorgada: listar roles → 403 (roles:read)', async ({ authedApi }) => {
    const res = await authedApi.get(APP_ENDPOINTS.roles);
    const body = await expectError(res, 403);
    expect(body.message).toContain('roles:read');
  });

  test('M6.5 - admin (comodín *) accede a roles sin capability explícita', async ({ adminApi }) => {
    const res = await adminApi.get(APP_ENDPOINTS.roles);
    const body = await expectSuccess(res, 200);
    expect(Array.isArray(body.data.roles)).toBeTruthy();
  });

  test('M6.6 - catálogo de capabilities agrupado por módulo (roles:create)', async ({ adminApi }) => {
    const res = await adminApi.get(APP_ENDPOINTS.rolesCatalog);
    const body = await expectSuccess(res, 200);
    expect(Array.isArray(body.data.catalog)).toBeTruthy();
    const modules = body.data.catalog.map((g: { module: string }) => g.module);
    expect(modules).toContain('usuarios');
    expect(modules).toContain('roles');
    expect(modules).toContain('areas');
  });
});
