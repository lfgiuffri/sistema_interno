import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, ADMIN_USERNAME, makeUser, makeRole } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M7 — Usuarios: ABM + protecciones.
 * Unicidad, toggle, baja lógica, auto-protecciones y protección del último admin.
 */
test.describe('M7: Usuarios', () => {
  const createdUsers: number[] = [];
  const createdRoles: number[] = [];

  test.afterAll(async () => {
    for (const id of createdUsers) await hardDeleteByPath(`users/${id}`);
    for (const id of createdRoles) await hardDeleteByPath(`users/roles/${id}`);
  });

  /** Crea un rol descartable y devuelve su id (para asignar a usuarios de prueba). */
  async function createRole(adminApi: import('@playwright/test').APIRequestContext): Promise<number> {
    const res = await adminApi.post(APP_ENDPOINTS.roles, { data: makeRole() });
    const body = await res.json();
    const id = body.data.role.id;
    createdRoles.push(id);
    return id;
  }

  test('M7.1 - POST /users → 201 crea usuario (sin password en la respuesta)', async ({ adminApi }) => {
    const roleId = await createRole(adminApi);
    const res = await adminApi.post(APP_ENDPOINTS.users, { data: makeUser({ roleId }) });
    const body = await expectSuccess(res, 201);
    expect(body.data).toHaveProperty('id');
    expect(body.data).not.toHaveProperty('password');
    createdUsers.push(body.data.id);
  });

  test('M7.2 - username duplicado → 400', async ({ adminApi }) => {
    const roleId = await createRole(adminApi);
    const user = makeUser({ roleId });
    const first = await adminApi.post(APP_ENDPOINTS.users, { data: user });
    createdUsers.push((await first.json()).data.id);

    const dup = await adminApi.post(APP_ENDPOINTS.users, {
      data: makeUser({ roleId, username: user.username }),
    });
    const body = await expectError(dup, 400);
    expect(body.message).toContain('nombre de usuario');
  });

  test('M7.3 - email duplicado → 400', async ({ adminApi }) => {
    const roleId = await createRole(adminApi);
    const user = makeUser({ roleId });
    const first = await adminApi.post(APP_ENDPOINTS.users, { data: user });
    createdUsers.push((await first.json()).data.id);

    const dup = await adminApi.post(APP_ENDPOINTS.users, {
      data: makeUser({ roleId, email: user.email }),
    });
    const body = await expectError(dup, 400);
    expect(body.message).toContain('email');
  });

  test('M7.4 - PATCH /users/:id/active alterna el estado', async ({ adminApi }) => {
    const roleId = await createRole(adminApi);
    const created = await adminApi.post(APP_ENDPOINTS.users, { data: makeUser({ roleId }) });
    const id = (await created.json()).data.id;
    createdUsers.push(id);

    const off = await adminApi.patch(`${APP_ENDPOINTS.users}/${id}/active`);
    const offBody = await expectSuccess(off, 200);
    expect(offBody.data).toHaveProperty('active', false);

    const on = await adminApi.patch(`${APP_ENDPOINTS.users}/${id}/active`);
    const onBody = await expectSuccess(on, 200);
    expect(onBody.data).toHaveProperty('active', true);
  });

  test('M7.5 - usuario desactivado no puede loguearse (mensaje genérico)', async ({ adminApi, unauthApi }) => {
    const roleId = await createRole(adminApi);
    const user = makeUser({ roleId });
    const created = await adminApi.post(APP_ENDPOINTS.users, { data: user });
    const id = (await created.json()).data.id;
    createdUsers.push(id);

    await adminApi.patch(`${APP_ENDPOINTS.users}/${id}/active`);
    const login = await unauthApi.post('auth/signin', {
      data: { username: user.username, password: user.password },
    });
    await expectError(login, 401);
  });

  test('M7.6 - DELETE /users/:id → baja lógica; el usuario ya no aparece', async ({ adminApi }) => {
    const roleId = await createRole(adminApi);
    const created = await adminApi.post(APP_ENDPOINTS.users, { data: makeUser({ roleId }) });
    const id = (await created.json()).data.id;
    createdUsers.push(id);

    const del = await adminApi.delete(`${APP_ENDPOINTS.users}/${id}`);
    await expectSuccess(del, 200);

    const after = await adminApi.get(`${APP_ENDPOINTS.users}/${id}`);
    await expectError(after, 404);
  });

  test('M7.7 - el admin no puede desactivarse a sí mismo → 400', async ({ adminApi }) => {
    const meRes = await adminApi.get('users/my-account');
    const myId = (await meRes.json()).data.user.id;

    const res = await adminApi.patch(`${APP_ENDPOINTS.users}/${myId}/active`);
    const body = await expectError(res, 400);
    expect(body.message).toContain('propio usuario');
  });

  test('M7.8 - el admin no puede eliminarse a sí mismo → 400', async ({ adminApi }) => {
    const meRes = await adminApi.get('users/my-account');
    const myId = (await meRes.json()).data.user.id;

    const res = await adminApi.delete(`${APP_ENDPOINTS.users}/${myId}`);
    const body = await expectError(res, 400);
    expect(body.message).toContain('propio usuario');
  });

  test('M7.9 - PUT /users/my-account edita el perfil propio sin capability', async ({ authedApi }) => {
    // El usuario de fixture NO tiene usuarios:update, pero SÍ puede editarse a sí mismo.
    const res = await authedApi.put('users/my-account', { data: { lastName: 'Fixture' } });
    const body = await expectSuccess(res, 200);
    expect(body.data).toHaveProperty('lastName', 'Fixture');
  });

  test('M7.10 - PUT /users/my-account no permite escalar rol ni activo', async ({ authedApi, adminApi }) => {
    // roleId/active/username no están whitelisteados: se ignoran silenciosamente.
    const before = await authedApi.get('users/my-account');
    const me = (await before.json()).data.user;

    await authedApi.put('users/my-account', { data: { lastName: me.lastName, roleId: 1, username: 'hacked' } });

    const after = await adminApi.get(`users/${me.id}`);
    const fresh = (await after.json()).data;
    expect(fresh.roleId).toBe(me.roleId);
    expect(fresh.username).toBe(me.username);
  });

  test('M7.11 - búsqueda por username encuentra al admin', async ({ adminApi }) => {
    const res = await adminApi.get(`${APP_ENDPOINTS.users}?search=${ADMIN_USERNAME}`);
    const body = await expectSuccess(res, 200);
    const usernames = body.data.users.map((u: { username: string }) => u.username);
    expect(usernames).toContain(ADMIN_USERNAME);
  });
});
