/**
 * Sistema Interno — Playwright global setup (single-tenant).
 *
 * Garantiza, antes de correr la suite, que existan el ROL y el USUARIO de fixture
 * estables contra los que se loguean los tests (capabilities acotadas: areas + usuarios:read).
 *
 * Estrategia (idempotente):
 *   1. Login como admin (ADMINUSER/ADMINPASS, rol Administrador `*`).
 *   2. Si el login del usuario de fixture ya funciona → nada que hacer.
 *   3. Si no: asegurar el rol de fixture (buscar por label o crearlo) y crear el usuario.
 *   4. Verificar que el login del usuario de fixture funcione.
 */
import { request } from '@playwright/test';
import { API_BASE, ADMIN_USERNAME, ADMIN_PASSWORD, FIXTURE_USER, FIXTURE_ROLE } from './helpers/constants';

async function globalSetup() {
  const api = await request.newContext({ baseURL: `${API_BASE}/` });

  try {
    // 1. Login admin.
    const loginRes = await api.post('auth/signin', {
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    if (!loginRes.ok()) {
      console.warn(`⚠️ [global-setup] Login de admin falló (${loginRes.status()}). ¿Backend levantado y base sembrada (npm run init_db)?`);
      return;
    }
    const { data: loginData } = await loginRes.json();
    const adminToken = loginData.accessToken;
    const authed = { 'x-access-token': adminToken };

    // 2. ¿Ya existe el usuario de fixture? (login con sus credenciales estables)
    const fixtureLogin = await api.post('auth/signin', {
      data: { username: FIXTURE_USER.username, password: FIXTURE_USER.password },
    });
    if (fixtureLogin.ok()) {
      console.log('✅ [global-setup] Usuario de fixture ya existe');
      return;
    }

    // 3a. Asegurar el rol de fixture.
    console.log('🔧 [global-setup] Creando rol + usuario de fixture para E2E...');
    const rolesRes = await api.get('users/roles', { headers: authed });
    const rolesBody = await rolesRes.json();
    let roleId: number | undefined = (rolesBody?.data?.roles || [])
      .find((r: { label: string }) => r.label === FIXTURE_ROLE.label)?.id;

    if (!roleId) {
      const createRole = await api.post('users/roles', { headers: authed, data: FIXTURE_ROLE });
      const roleBody = await createRole.json();
      if (!createRole.ok()) {
        console.warn(`⚠️ [global-setup] No se pudo crear el rol de fixture: ${roleBody?.message}`);
        return;
      }
      roleId = roleBody.data.role.id;
    } else {
      // El rol ya existe: sincronizar capabilities (por si el set del fixture cambió).
      await api.put(`users/roles/${roleId}`, { headers: authed, data: FIXTURE_ROLE });
    }

    // 3b. Crear el usuario de fixture con ese rol.
    const createUser = await api.post('users', {
      headers: authed,
      data: { ...FIXTURE_USER, roleId },
    });
    if (!createUser.ok()) {
      const body = await createUser.text();
      // "Ya existe" puede pasar si quedó de una corrida anterior con otra contraseña.
      console.warn(`⚠️ [global-setup] No se pudo crear el usuario de fixture: ${body}`);
      return;
    }

    // 4. Verificar login del usuario de fixture.
    const verifyRes = await api.post('auth/signin', {
      data: { username: FIXTURE_USER.username, password: FIXTURE_USER.password },
    });
    if (verifyRes.ok()) {
      console.log('✅ [global-setup] Usuario de fixture creado y verificado');
    } else {
      console.warn(`⚠️ [global-setup] Login del usuario de fixture falló: ${await verifyRes.text()}`);
    }
  } finally {
    await api.dispose();
  }
}

export default globalSetup;
