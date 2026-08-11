import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M13 — Espacios de trabajo: ABM protegido, reactivación de eliminados y la matriz
 * de accesos de doble eje (espacio ↔ usuario; los admin nunca se tocan).
 */
test.describe('M13: Espacios de trabajo', () => {
  const cleanup: string[] = [];

  test.afterAll(async () => {
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  async function createEspacio(adminApi: import('@playwright/test').APIRequestContext) {
    const res = await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('Espacio') });
    const body = await expectSuccess(res, 201);
    cleanup.push(`espacios/${body.data.id}`);
    return body.data;
  }

  test('M13.1 - crear espacio → 201; el creador queda con acceso total', async ({ adminApi }) => {
    const espacio = await createEspacio(adminApi);
    expect(espacio.activo).toBe(true);

    const matriz = await adminApi.get(`${APP_ENDPOINTS.espacios}/${espacio.id}/usuarios`);
    const filas = (await expectSuccess(matriz, 200)).data as Array<{ porRol: boolean; ver: boolean }>;
    // El admin figura por rol con acceso total.
    expect(filas.some(f => f.porRol && f.ver)).toBeTruthy();
  });

  test('M13.2 - nombre duplicado → 400; eliminado homónimo → 409 EXISTE_ELIMINADO + restore', async ({ adminApi }) => {
    const espacio = await createEspacio(adminApi);

    const dup = await adminApi.post(APP_ENDPOINTS.espacios, { data: { nombre: espacio.nombre } });
    await expectError(dup, 400);

    await adminApi.delete(`${APP_ENDPOINTS.espacios}/${espacio.id}`);
    const otra = await adminApi.post(APP_ENDPOINTS.espacios, { data: { nombre: espacio.nombre } });
    const body = await expectError(otra, 409);
    expect(body.errorCode).toBe('EXISTE_ELIMINADO');
    expect(body.deletedId).toBe(espacio.id);

    const restore = await adminApi.patch(`${APP_ENDPOINTS.espacios}/${espacio.id}/restore`);
    await expectSuccess(restore, 200);
  });

  test('M13.3 - un espacio con listas no se elimina → 409', async ({ adminApi }) => {
    const espacio = await createEspacio(adminApi);
    await adminApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacio.id}/listas`, { data: { nombre: 'Lista M13' } });

    const del = await adminApi.delete(`${APP_ENDPOINTS.espacios}/${espacio.id}`);
    const body = await expectError(del, 409);
    expect(body.message).toContain('lista');
  });

  test('M13.4 - matriz eje usuario: editar⇒ver y cada eje reemplaza solo lo suyo', async ({ adminApi }) => {
    const espacio = await createEspacio(adminApi);
    const espacio2 = await createEspacio(adminApi);

    // Usuario no-admin de prueba (el fixture user e2e-fixture existe siempre).
    const usuarios = await adminApi.get('users?limit=100');
    const fixture = (await usuarios.json()).data.users.find((u: { username: string }) => u.username === 'e2e-fixture');
    expect(fixture).toBeTruthy();

    // Eje usuario: darle ver en espacio1 y editar-sin-ver en espacio2 (se descarta).
    const putUsuario = await adminApi.put(`${APP_ENDPOINTS.espacios}/usuario/${fixture.id}`, {
      data: {
        espacios: [
          { espacioId: espacio.id, ver: true, editar: false },
          { espacioId: espacio2.id, ver: false, editar: true },
        ],
      },
    });
    await expectSuccess(putUsuario, 200);

    const lectura = await adminApi.get(`${APP_ENDPOINTS.espacios}/usuario/${fixture.id}`);
    const data = (await lectura.json()).data;
    const e1 = data.espacios.find((e: { espacioId: number }) => e.espacioId === espacio.id);
    const e2 = data.espacios.find((e: { espacioId: number }) => e.espacioId === espacio2.id);
    expect(e1.ver).toBe(true);
    expect(e1.editar).toBe(false);
    expect(e2.ver).toBe(false); // editar sin ver se descartó

    // Eje espacio (espacio2): darle ver+editar; NO debe pisar el acceso al espacio1.
    const putEspacio = await adminApi.put(`${APP_ENDPOINTS.espacios}/${espacio2.id}/usuarios`, {
      data: { usuarios: [{ userId: fixture.id, ver: true, editar: true }] },
    });
    await expectSuccess(putEspacio, 200);

    const relectura = await adminApi.get(`${APP_ENDPOINTS.espacios}/usuario/${fixture.id}`);
    const data2 = (await relectura.json()).data;
    expect(data2.espacios.find((e: { espacioId: number }) => e.espacioId === espacio.id).ver).toBe(true); // intacto
    expect(data2.espacios.find((e: { espacioId: number }) => e.espacioId === espacio2.id).editar).toBe(true);

    // Limpieza de accesos del fixture (no ensuciar otros tests).
    await adminApi.put(`${APP_ENDPOINTS.espacios}/usuario/${fixture.id}`, { data: { espacios: [] } });
  });

  test('M13.5 - la matriz de un admin no se edita → 403', async ({ adminApi }) => {
    const usuarios = await adminApi.get('users?limit=100');
    const admin = (await usuarios.json()).data.users.find((u: { username: string }) => u.username === 'admin');
    const res = await adminApi.put(`${APP_ENDPOINTS.espacios}/usuario/${admin.id}`, { data: { espacios: [] } });
    await expectError(res, 403);
  });

  test('M13.6 - capability gating: el fixture no administra espacios → 403', async ({ authedApi }) => {
    const res = await authedApi.get(APP_ENDPOINTS.espacios);
    const body = await expectError(res, 403);
    expect(body.message).toContain('espacios:read');
  });
});
