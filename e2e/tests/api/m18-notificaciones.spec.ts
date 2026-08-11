import { test, expect } from '../../fixtures/auth.fixture';
import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { APP_ENDPOINTS, AUTH_ENDPOINTS, API_BASE, makeNombre, makeUser, makeRole } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M18 — Fase 6: notificaciones in-app, comentarios con menciones, cotización histórica
 * y el dashboard completo (estadísticas + tareas del equipo).
 * SERIAL: el flujo encadena asignación → notificación → comentario → mención.
 */
test.describe.configure({ mode: 'serial' });

test.describe('M18: Notificaciones, comentarios y panel completo', () => {
  const cleanup: string[] = [];
  let espacioId = 0;
  let listaId = 0;
  let tareaId = 0;
  let userId = 0;
  let username = '';
  let userApi: APIRequestContext;

  test.beforeAll(async ({ adminApi }) => {
    const e = await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('Espacio N18') });
    espacioId = (await e.json()).data.id;
    cleanup.push(`espacios/${espacioId}`);

    const rol = await adminApi.post('users/roles', {
      data: makeRole({ capabilities: ['tareas:read', 'tareas:create', 'tareas:update', 'tareas:estado', 'dashboard:read'] }),
    });
    const roleId = (await rol.json()).data.role.id;
    const uData = makeUser({ roleId });
    const usuario = await adminApi.post('users', { data: uData });
    const uBody = await usuario.json();
    userId = uBody.data.id;
    username = uBody.data.username;
    cleanup.push(`users/${userId}`, `users/roles/${roleId}`);

    await adminApi.put(`${APP_ENDPOINTS.espacios}/usuario/${userId}`, {
      data: { espacios: [{ espacioId, ver: true, editar: true }] },
    });

    const lista = await adminApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacioId}/listas`, { data: { nombre: 'General' } });
    listaId = (await lista.json()).data.id;

    const signin = await adminApi.post(AUTH_ENDPOINTS.signin, { data: { username, password: 'E2eTest123456' } });
    const { accessToken } = (await signin.json()).data;
    userApi = await pwRequest.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: { 'x-access-token': accessToken },
    });
  });

  test.afterAll(async () => {
    await userApi?.dispose();
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  test('M18.1 - asignar una tarea a otro genera notificación in-app', async ({ adminApi }) => {
    const tarea = await adminApi.post(APP_ENDPOINTS.tareas, {
      data: { listaId, nombre: 'Tarea notificada', asignadoA: userId },
    });
    tareaId = (await expectSuccess(tarea, 201)).data.id;

    const notifs = await userApi.get('notificaciones');
    const body = await expectSuccess(notifs, 200);
    expect(body.data.noLeidas).toBeGreaterThanOrEqual(1);
    const asignada = body.data.rows.find((n: { tipo: string }) => n.tipo === 'tarea-asignada');
    expect(asignada).toBeTruthy();
    expect(asignada.cuerpo).toContain('Tarea notificada');
  });

  test('M18.2 - marcar leídas deja el contador en cero', async () => {
    const res = await userApi.patch('notificaciones/leidas', { data: {} });
    await expectSuccess(res, 200);
    const notifs = await userApi.get('notificaciones');
    expect((await notifs.json()).data.noLeidas).toBe(0);
  });

  test('M18.3 - comentario con mención @username notifica al mencionado', async ({ adminApi }) => {
    // El usuario comenta mencionando al admin.
    const res = await userApi.post(`${APP_ENDPOINTS.tareas}/${tareaId}/comentarios`, {
      data: { texto: `Necesito una mano @admin con esto` },
    });
    const body = await expectSuccess(res, 201);
    expect(body.data.texto).toContain('@admin');

    // El detalle incluye el comentario.
    const detalle = await userApi.get(`${APP_ENDPOINTS.tareas}/${tareaId}`);
    const comentarios = (await detalle.json()).data.comentarios;
    expect(comentarios).toHaveLength(1);

    // El admin recibió la notificación de mención.
    const notifsAdmin = await adminApi.get('notificaciones');
    const mencion = (await notifsAdmin.json()).data.rows.find((n: { tipo: string }) => n.tipo === 'tarea-comentario');
    expect(mencion).toBeTruthy();
  });

  test('M18.4 - un comentario ajeno no se puede eliminar → 403 (el propio sí)', async ({ adminApi }) => {
    const detalle = await userApi.get(`${APP_ENDPOINTS.tareas}/${tareaId}`);
    const comentario = (await detalle.json()).data.comentarios[0];

    // El admin es admin (comodín) → puede; probamos el caso inverso: user borra un
    // comentario del admin.
    const delAdmin = await adminApi.post(`${APP_ENDPOINTS.tareas}/${tareaId}/comentarios`, { data: { texto: 'Comentario del admin' } });
    const comentarioAdmin = (await delAdmin.json()).data;
    const intento = await userApi.delete(`${APP_ENDPOINTS.tareas}/comentarios/${comentarioAdmin.id}`);
    await expectError(intento, 403);

    // El propio sí.
    const propio = await userApi.delete(`${APP_ENDPOINTS.tareas}/comentarios/${comentario.id}`);
    await expectSuccess(propio, 200);
  });

  test('M18.5 - la cotización deja histórico con usuario', async ({ adminApi }) => {
    await adminApi.put('app-config', { data: { name: 'COTIZACION_DOLAR', value: '1111' } });
    await adminApi.put('app-config', { data: { name: 'COTIZACION_DOLAR', value: '1000' } });

    const res = await adminApi.get('app-config/cotizaciones');
    const body = await expectSuccess(res, 200);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.data[0].valor).toBe(1000);
    expect(body.data[1].valor).toBe(1111);
    expect(body.data[0].usuario).toBeTruthy();
  });

  test('M18.6 - dashboard completo: estadísticas + tareas del equipo (por capability)', async ({ adminApi }) => {
    const res = await adminApi.get('dashboard?anio=2026');
    const data = (await expectSuccess(res, 200)).data;

    // Estadísticas: series de 12 meses + años disponibles.
    expect(data.estadisticas).toBeTruthy();
    expect(data.estadisticas.mensual.abonos).toHaveLength(12);
    expect(data.estadisticas.mensual.proyectos).toHaveLength(12);
    expect(Array.isArray(data.estadisticas.anios)).toBeTruthy();

    // Tareas del equipo: tarjetas + tabla por usuario.
    expect(data.tareasEquipo).toBeTruthy();
    expect(data.tareasEquipo.tarjetas.pendientes).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.tareasEquipo.porUsuario)).toBeTruthy();

    // El usuario acotado (sin abonos/facturaciones) NO recibe estadísticas.
    const resUser = await userApi.get('dashboard');
    const dataUser = (await resUser.json()).data;
    expect(dataUser.estadisticas).toBeNull();
    expect(dataUser.tareasEquipo).toBeTruthy(); // tareas:read sí tiene
  });
});
