import { test, expect } from '../../fixtures/auth.fixture';
import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { APP_ENDPOINTS, AUTH_ENDPOINTS, API_BASE, makeNombre, makeUser, makeRole } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M14 — Tareas: las DOS capas de permiso (capability + espacio), historial de estados,
 * saneado de HTML, edición rápida que no destruye, mover de lista y la coincidencia
 * número ↔ listado del resumen.
 */
// SERIAL a propósito: el flujo otorga permisos de espacio progresivamente (sin acceso →
// ver → ver+editar) y los tests posteriores dependen de ese estado.
test.describe.configure({ mode: 'serial' });

test.describe('M14: Tareas y listas', () => {
  const cleanup: string[] = [];
  let espacio1 = 0; // el usuario de tareas tendrá ver+editar acá (se otorga en M14.2/3)
  let espacio2 = 0; // acá NO tendrá editar
  let userId = 0;
  let tareasApi: APIRequestContext; // usuario con capabilities de tareas pero acceso por espacio acotado

  test.beforeAll(async ({ adminApi }) => {
    const e1 = await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('Espacio T1') });
    espacio1 = (await e1.json()).data.id;
    const e2 = await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('Espacio T2') });
    espacio2 = (await e2.json()).data.id;
    cleanup.push(`espacios/${espacio1}`, `espacios/${espacio2}`);

    // Rol con la capa 1 completa de tareas (SIN tareas:asignar, a propósito).
    const rol = await adminApi.post('users/roles', {
      data: makeRole({ capabilities: ['tareas:read', 'tareas:create', 'tareas:update', 'tareas:delete', 'tareas:estado'] }),
    });
    const roleId = (await rol.json()).data.role.id;
    const usuario = await adminApi.post('users', { data: makeUser({ roleId }) });
    const uBody = await usuario.json();
    userId = uBody.data.id;
    cleanup.push(`users/${userId}`, `users/roles/${roleId}`);

    const signin = await adminApi.post(AUTH_ENDPOINTS.signin, {
      data: { username: uBody.data.username, password: 'E2eTest123456' },
    });
    const { accessToken } = (await signin.json()).data;
    tareasApi = await pwRequest.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: { 'x-access-token': accessToken },
    });
  });

  test.afterAll(async () => {
    await tareasApi?.dispose();
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  test('M14.1 - capa 2: con capability pero SIN acceso al espacio → 403 y home vacía', async ({ adminApi }) => {
    void adminApi;
    const home = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios`);
    const body = await expectSuccess(home, 200);
    expect(body.data.espacios).toHaveLength(0);

    const listas = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`);
    const err = await expectError(listas, 403);
    expect(err.message).toContain('acceso a este espacio');
  });

  test('M14.2 - capa 2: con VER pero sin EDITAR → lee pero no muta', async ({ adminApi }) => {
    await adminApi.put(`${APP_ENDPOINTS.espacios}/usuario/${userId}`, {
      data: { espacios: [{ espacioId: espacio1, ver: true, editar: false }] },
    });

    const listas = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`);
    const body = await expectSuccess(listas, 200);
    expect(body.data.puedeEditar).toBe(false);

    const crear = await tareasApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`, { data: { nombre: 'Prohibida' } });
    const err = await expectError(crear, 403);
    expect(err.message).toContain('modificar tareas');
  });

  test('M14.3 - capa 2 completa: ver+editar → crea lista y tarea', async ({ adminApi }) => {
    await adminApi.put(`${APP_ENDPOINTS.espacios}/usuario/${userId}`, {
      data: { espacios: [{ espacioId: espacio1, ver: true, editar: true }, { espacioId: espacio2, ver: true, editar: false }] },
    });

    const lista = await tareasApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`, { data: { nombre: 'General' } });
    const lBody = await expectSuccess(lista, 201);

    const tarea = await tareasApi.post(APP_ENDPOINTS.tareas, {
      data: { listaId: lBody.data.id, nombre: 'Tarea propia', asignadoA: userId, prioridad: 'rojo' },
    });
    const tBody = await expectSuccess(tarea, 201);
    expect(tBody.data.historial).toHaveLength(1); // creación con estadoAnterior null
    expect(tBody.data.historial[0].estadoAnterior).toBeNull();
  });

  test('M14.4 - tareas:asignar: asignar a OTRO sin la capability → 403; a sí mismo OK', async () => {
    const listas = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`);
    const listaId = (await listas.json()).data.listas[0].id;

    const aOtro = await tareasApi.post(APP_ENDPOINTS.tareas, {
      data: { listaId, nombre: 'Para el admin', asignadoA: 1 },
    });
    const err = await expectError(aOtro, 403);
    expect(err.message).toContain('tareas:asignar');
  });

  test('M14.5 - estado: inválido → 422; válido registra historial una sola vez', async () => {
    const listas = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`);
    const listaId = (await listas.json()).data.listas[0].id;
    const tarea = await tareasApi.post(APP_ENDPOINTS.tareas, { data: { listaId, nombre: 'Con estados' } });
    const id = (await tarea.json()).data.id;

    await expectError(await tareasApi.patch(`${APP_ENDPOINTS.tareas}/${id}/estado`, { data: { estado: 'reabierta' } }), 422);

    await expectSuccess(await tareasApi.patch(`${APP_ENDPOINTS.tareas}/${id}/estado`, { data: { estado: 'en_progreso' } }), 200);
    // Repetir el mismo estado NO agrega historial (regla del legado).
    const repe = await tareasApi.patch(`${APP_ENDPOINTS.tareas}/${id}/estado`, { data: { estado: 'en_progreso' } });
    expect((await repe.json()).data.cambio).toBe(false);

    const detalle = await tareasApi.get(`${APP_ENDPOINTS.tareas}/${id}`);
    const historial = (await detalle.json()).data.historial;
    expect(historial).toHaveLength(2); // creación + un solo cambio
  });

  test('M14.6 - edición rápida NO borra la descripción ni toca el estado', async () => {
    const listas = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`);
    const listaId = (await listas.json()).data.listas[0].id;
    const tarea = await tareasApi.post(APP_ENDPOINTS.tareas, {
      data: { listaId, nombre: 'Con descripción', descripcion: '<p>contenido valioso</p>', estado: 'en_progreso' },
    });
    const id = (await tarea.json()).data.id;

    await expectSuccess(await tareasApi.patch(`${APP_ENDPOINTS.tareas}/${id}/rapida`, { data: { nombre: 'Renombrada', prioridad: 'amarillo' } }), 200);

    const detalle = await tareasApi.get(`${APP_ENDPOINTS.tareas}/${id}`);
    const data = (await detalle.json()).data;
    expect(data.descripcion).toContain('contenido valioso');
    expect(data.estado).toBe('en_progreso');
    expect(data.nombre).toBe('Renombrada');
  });

  test('M14.7 - el HTML de la descripción se sanea en servidor (XSS fuera)', async () => {
    const listas = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`);
    const listaId = (await listas.json()).data.listas[0].id;
    const res = await tareasApi.post(APP_ENDPOINTS.tareas, {
      data: {
        listaId,
        nombre: 'XSS',
        descripcion: '<p onclick="x()">hola</p><script>alert(1)</script><img src="https://evil.test/a.png"><a href="javascript:boom()">link</a>',
      },
    });
    const desc = (await res.json()).data.descripcion as string;
    expect(desc).not.toContain('<script');
    expect(desc).not.toContain('onclick');
    expect(desc).not.toContain('evil.test');
    expect(desc).not.toContain('javascript:');
    expect(desc).toContain('hola');
  });

  test('M14.8 - mover: a una lista de un espacio donde NO edita → 403 (mejora validada)', async ({ adminApi }) => {
    // Lista destino en espacio2 (el usuario solo VE espacio2), creada por el admin.
    const listaAjena = await adminApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacio2}/listas`, { data: { nombre: 'Ajena' } });
    const destinoId = (await listaAjena.json()).data.id;

    const listas = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`);
    const listaId = (await listas.json()).data.listas[0].id;
    const tarea = await tareasApi.post(APP_ENDPOINTS.tareas, { data: { listaId, nombre: 'Movible' } });
    const id = (await tarea.json()).data.id;

    await expectError(await tareasApi.patch(`${APP_ENDPOINTS.tareas}/${id}/mover`, { data: { listaId: destinoId } }), 403);

    // El admin sí puede moverla (edita ambos espacios por rol).
    const mv = await adminApi.patch(`${APP_ENDPOINTS.tareas}/${id}/mover`, { data: { listaId: destinoId } });
    const body = await expectSuccess(mv, 200);
    expect(body.data.espacioId).toBe(espacio2);
  });

  test('M14.9 - resumen por categorías: el número coincide con el listado', async () => {
    const res = await tareasApi.get(`${APP_ENDPOINTS.tareas}/resumen?f=pendientes&u=todos`);
    const body = await expectSuccess(res, 200);
    const listadas = body.data.grupos.flatMap((g: { listas: Array<{ tareas: unknown[] }> }) => g.listas).reduce(
      (acc: number, l: { tareas: unknown[] }) => acc + l.tareas.length, 0,
    );
    expect(body.data.conteos.pendientes).toBe(listadas);
    // El resumen del usuario acotado solo ve SUS espacios (espacio1 y espacio2).
    for (const g of body.data.grupos) expect([espacio1, espacio2]).toContain(g.espacioId);
  });

  test('M14.10 - una lista con tareas no se elimina → 409; tarea inexistente → 404 real', async () => {
    const listas = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`);
    const conTareas = (await listas.json()).data.listas.find((l: { total: number }) => l.total > 0);
    const del = await tareasApi.delete(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas/${conTareas.id}`);
    const body = await expectError(del, 409);
    expect(body.message).toContain('tarea(s)');

    await expectError(await tareasApi.delete(`${APP_ENDPOINTS.tareas}/999999`), 404);
  });

  test('M14.11 - capability gating: el fixture (sin tareas:read) → 403', async ({ authedApi }) => {
    const res = await authedApi.get(`${APP_ENDPOINTS.tareas}/espacios`);
    const body = await expectError(res, 403);
    expect(body.message).toContain('tareas:read');
  });
});
