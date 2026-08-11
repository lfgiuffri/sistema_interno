import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeRole, makeUser } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M8 — Roles: ABM + reglas de la matriz de capabilities.
 * Comodín no asignable, rol Administrador intocable, no borrar roles en uso.
 */
test.describe('M8: Roles', () => {
  const createdRoles: number[] = [];
  const createdUsers: number[] = [];

  test.afterAll(async () => {
    for (const id of createdUsers) await hardDeleteByPath(`users/${id}`);
    for (const id of createdRoles) await hardDeleteByPath(`users/roles/${id}`);
  });

  test('M8.1 - POST /users/roles → 201 con capabilities aplicadas', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.roles, {
      data: makeRole({ capabilities: ['areas:read', 'areas:create'] }),
    });
    const body = await expectSuccess(res, 201);
    expect(body.data.role).toHaveProperty('id');
    expect(body.data.capabilities).toEqual(expect.arrayContaining(['areas:read', 'areas:create']));
    createdRoles.push(body.data.role.id);
  });

  test('M8.2 - comodín * no asignable → 400', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.roles, { data: makeRole({ capabilities: ['*'] }) });
    const body = await expectError(res, 400);
    expect(body.message).toContain('Administrador');
  });

  test('M8.3 - capability desconocida → 400', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.roles, {
      data: makeRole({ capabilities: ['inventada:accion'] }),
    });
    const body = await expectError(res, 400);
    expect(body.message).toContain('inventada:accion');
  });

  test('M8.4 - label duplicado → 400', async ({ adminApi }) => {
    const role = makeRole();
    const first = await adminApi.post(APP_ENDPOINTS.roles, { data: role });
    createdRoles.push((await first.json()).data.role.id);

    const dup = await adminApi.post(APP_ENDPOINTS.roles, { data: makeRole({ label: role.label }) });
    await expectError(dup, 400);
  });

  test('M8.5 - el rol Administrador (isSystem) no se puede editar → 400', async ({ adminApi }) => {
    const list = await adminApi.get(APP_ENDPOINTS.roles);
    const roles = (await list.json()).data.roles;
    const adminRole = roles.find((r: { isSystem: boolean }) => r.isSystem);
    expect(adminRole).toBeDefined();

    const res = await adminApi.put(`${APP_ENDPOINTS.roles}/${adminRole.id}`, {
      data: { label: 'Hackeado', capabilities: [] },
    });
    const body = await expectError(res, 400);
    expect(body.message).toContain('Administrador');
  });

  test('M8.6 - el rol Administrador no se puede eliminar → 400', async ({ adminApi }) => {
    const list = await adminApi.get(APP_ENDPOINTS.roles);
    const adminRole = (await list.json()).data.roles.find((r: { isSystem: boolean }) => r.isSystem);

    const res = await adminApi.delete(`${APP_ENDPOINTS.roles}/${adminRole.id}`);
    const body = await expectError(res, 400);
    expect(body.message).toContain('Administrador');
  });

  test('M8.7 - un rol con usuarios no se puede eliminar → 409', async ({ adminApi }) => {
    const roleRes = await adminApi.post(APP_ENDPOINTS.roles, { data: makeRole() });
    const roleId = (await roleRes.json()).data.role.id;
    createdRoles.push(roleId);

    const userRes = await adminApi.post(APP_ENDPOINTS.users, { data: makeUser({ roleId }) });
    createdUsers.push((await userRes.json()).data.id);

    const del = await adminApi.delete(`${APP_ENDPOINTS.roles}/${roleId}`);
    const body = await expectError(del, 409);
    expect(body.message).toContain('usuario');
  });

  test('M8.8 - PUT actualiza el set de capabilities (reemplazo completo)', async ({ adminApi }) => {
    const roleRes = await adminApi.post(APP_ENDPOINTS.roles, {
      data: makeRole({ capabilities: ['areas:read', 'areas:create'] }),
    });
    const created = (await roleRes.json()).data.role;
    createdRoles.push(created.id);

    const res = await adminApi.put(`${APP_ENDPOINTS.roles}/${created.id}`, {
      data: { label: created.label, capabilities: ['usuarios:read'] },
    });
    const body = await expectSuccess(res, 200);
    expect(body.data.capabilities).toEqual(['usuarios:read']);
  });
});
