import { test, expect } from '../../fixtures/auth.fixture';
import { request as pwRequest, type APIRequestContext } from '@playwright/test';
import { APP_ENDPOINTS, API_BASE, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M23 — Portal de clientes.
 *
 * El corazón de este spec es el AISLAMIENTO entre las dos superficies de autenticación. El
 * sistema firma los tokens internos con `JWT_SECRET` y `verifyAccessToken` resuelve
 * `User.findOne({ id: decoded.id })`: sin cerrojos, un token de cliente con `id: 1` sería el
 * administrador del seed. Los tres tests negativos de M23.2 son toda esa historia.
 */
test.describe.configure({ mode: 'serial' });

test.describe('M23: Portal de clientes', () => {
  const cleanup: string[] = [];
  let clienteA = 0;
  let clienteB = 0;
  let usuarioA = 0;
  let emailA = '';
  /** Contexto autenticado como el usuario de portal del cliente A. */
  let portalA: APIRequestContext;
  /** Incidencia del cliente B, para probar que A no la puede tocar. */
  let incidenciaDeB = 0;
  /** Espacio y lista internos, para convertir una incidencia en tarea (M23.7). */
  let espacioId = 0;
  let listaId = 0;

  test.beforeAll(async ({ adminApi }) => {
    const a = await adminApi.post(APP_ENDPOINTS.clientes, { data: makeNombre('Cliente Portal A') });
    clienteA = (await a.json()).data.id;
    const b = await adminApi.post(APP_ENDPOINTS.clientes, { data: makeNombre('Cliente Portal B') });
    clienteB = (await b.json()).data.id;
    cleanup.push(`clientes/${clienteA}`, `clientes/${clienteB}`);

    emailA = `portal-${Date.now()}@a.test`;
    const u = await adminApi.post(`${APP_ENDPOINTS.clientes}/${clienteA}/usuarios`, {
      data: { nombre: 'Ana Cliente', email: emailA, password: 'PortalTest123' },
    });
    usuarioA = (await expectSuccess(u, 201)).data.id;

    const inc = await adminApi.post(APP_ENDPOINTS.incidencias, { data: { clienteId: clienteB, titulo: 'De otro cliente' } });
    incidenciaDeB = (await inc.json()).data.id;

    const esp = await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('Espacio Portal') });
    espacioId = (await esp.json()).data.id;
    cleanup.push(`espacios/${espacioId}`);
    const lista = await adminApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacioId}/listas`, { data: makeNombre('Entrantes Portal') });
    listaId = (await lista.json()).data.id;
  });

  test.afterAll(async () => {
    await portalA?.dispose();
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  test('M23.1 - login del portal: email + contraseña, y nunca devuelve el hash', async ({ request }) => {
    const res = await request.post(`${API_BASE}/portal/auth/signin`, {
      data: { email: emailA, password: 'PortalTest123' },
    });
    const body = await expectSuccess(res, 200);
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.usuario.cliente.id).toBe(clienteA);
    expect(body.data.usuario).not.toHaveProperty('password');

    portalA = await pwRequest.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: { 'x-access-token': body.data.accessToken, 'Content-Type': 'application/json' },
    });

    // Mensaje ÚNICO: no se le confirma a nadie si el mail existe o si la clave está mal.
    const malPass = await request.post(`${API_BASE}/portal/auth/signin`, { data: { email: emailA, password: 'xxxxxxxx' } });
    const noExiste = await request.post(`${API_BASE}/portal/auth/signin`, { data: { email: 'nadie@nada.test', password: 'xxxxxxxx' } });
    expect(malPass.status()).toBe(401);
    expect(noExiste.status()).toBe(401);
    expect((await malPass.json()).message).toBe((await noExiste.json()).message);
  });

  test('M23.2 - AISLAMIENTO: los tokens no cruzan entre las dos superficies', async ({ adminApi, adminTokens, request }) => {
    const login = await request.post(`${API_BASE}/portal/auth/signin`, {
      data: { email: emailA, password: 'PortalTest123' },
    });
    const tokenPortal = (await login.json()).data.accessToken;

    // 1. Un token de PORTAL contra la API interna. Sin los cerrojos (secreto propio, `type`
    //    propio y el id en `sub` y no en `id`), resolvería a un `User` con ese mismo número.
    const contraInterna = await pwRequest.newContext({
      baseURL: `${API_BASE}/`, extraHTTPHeaders: { 'x-access-token': tokenPortal },
    });
    expect((await contraInterna.get(APP_ENDPOINTS.clientes)).status()).toBe(401);
    expect((await contraInterna.get(APP_ENDPOINTS.tareas + '/espacios')).status()).toBe(401);
    await contraInterna.dispose();

    // 2. Un token INTERNO contra el portal.
    const contraPortal = await pwRequest.newContext({
      baseURL: `${API_BASE}/`, extraHTTPHeaders: { 'x-access-token': adminTokens.accessToken },
    });
    expect((await contraPortal.get('portal/incidencias')).status()).toBe(401);
    await contraPortal.dispose();

    // 3. El token de portal tampoco abre el socket: al conectarse, una sesión se une a la room
    //    `app`, que recibe los broadcasts de TODOS los clientes.
    const { io } = await import('socket.io-client');
    const { BACKEND_URL } = await import('../../helpers/constants');
    const socket = io(BACKEND_URL, { auth: { token: tokenPortal }, transports: ['websocket'], reconnection: false });
    const resultado = await new Promise<string>((resolve) => {
      socket.on('connect', () => resolve('conectó'));
      socket.on('connect_error', () => resolve('rechazado'));
      setTimeout(() => resolve('timeout'), 8000);
    });
    socket.disconnect();
    expect(resultado).toBe('rechazado');

    // Y el admin sigue entrando a lo suyo, por las dudas.
    await expectSuccess(await adminApi.get(APP_ENDPOINTS.clientes), 200);
  });

  test('M23.3 - el cliente solo ve LO SUYO, y lo ajeno da 404 (no 403)', async () => {
    const propia = await expectSuccess(await portalA.post('portal/incidencias', {
      data: { titulo: 'Mi incidencia', descripcion: 'Desde el portal.' },
    }), 201);
    cleanup.push(`incidencias/${propia.data.id}`);
    // El `clienteId` sale del token, no del body: el cliente no elige a nombre de quién carga.
    expect(propia.data.clienteId).toBe(clienteA);

    const mias = await expectSuccess(await portalA.get('portal/incidencias'), 200);
    expect(mias.data.every((i: { clienteId: number }) => i.clienteId === clienteA)).toBe(true);
    expect(mias.data.map((i: { id: number }) => i.id)).not.toContain(incidenciaDeB);

    // 404 y no 403: a un tercero no se le confirma que ese id existe.
    expect((await portalA.get(`portal/incidencias/${incidenciaDeB}`)).status()).toBe(404);
  });

  test('M23.4 - el cliente NO puede mover el estado ni por el portal ni por la API interna', async () => {
    const mias = await expectSuccess(await portalA.get('portal/incidencias'), 200);
    const id = mias.data[0].id;

    // La ruta de estado no existe del lado del portal.
    expect((await portalA.patch(`portal/incidencias/${id}/estado`, { data: { estado: 'resuelta' } })).status()).toBe(404);
    // Y la interna le pide una sesión interna, que no tiene.
    expect((await portalA.patch(`${APP_ENDPOINTS.incidencias}/${id}/estado`, { data: { estado: 'resuelta' } })).status()).toBe(401);
  });

  test('M23.5 - desactivar al usuario corta el acceso YA, sin esperar a que expire el token', async ({ adminApi }) => {
    // El middleware relee `ClienteUsuario` y su `Cliente` en cada request justamente por esto:
    // una baja tiene que impactar de inmediato, no cuando venza la sesión.
    await expectSuccess(await portalA.get('portal/incidencias'), 200);

    await expectSuccess(await adminApi.patch(`${APP_ENDPOINTS.clientes}/${clienteA}/usuarios/${usuarioA}/active`), 200);
    expect((await portalA.get('portal/incidencias')).status()).toBe(403);

    // Y al reactivarlo, el MISMO token vuelve a funcionar.
    await expectSuccess(await adminApi.patch(`${APP_ENDPOINTS.clientes}/${clienteA}/usuarios/${usuarioA}/active`), 200);
    await expectSuccess(await portalA.get('portal/incidencias'), 200);
  });

  test('M23.6 - el ABM de usuarios de portal exige `clientes:usuarios`', async ({ authedApi, unauthApi, adminApi }) => {
    await expectError(await unauthApi.get(`${APP_ENDPOINTS.clientes}/${clienteA}/usuarios`), 401);
    await expectError(await authedApi.get(`${APP_ENDPOINTS.clientes}/${clienteA}/usuarios`), 403);

    // El email es la credencial de login: no se puede repetir.
    await expectError(await adminApi.post(`${APP_ENDPOINTS.clientes}/${clienteA}/usuarios`, {
      data: { nombre: 'Otro', email: emailA, password: 'PortalTest123' },
    }), 400);
    // Y la contraseña tiene un mínimo.
    await expectError(await adminApi.post(`${APP_ENDPOINTS.clientes}/${clienteA}/usuarios`, {
      data: { nombre: 'Corto', email: `corto-${Date.now()}@a.test`, password: 'abc' },
    }), 422);
  });

  test('M23.7 - el cliente ve la FECHA ESTIMADA pero NUNCA la tarea que hay detrás', async ({ adminApi }) => {
    const propia = await expectSuccess(await portalA.post('portal/incidencias', {
      data: { titulo: 'Con tarea detrás' },
    }), 201);
    const incId = propia.data.id;
    cleanup.push(`incidencias/${incId}`);

    await expectSuccess(await adminApi.post(`${APP_ENDPOINTS.incidencias}/${incId}/tarea`, {
      data: { listaId, fechaVencimiento: '2026-11-30' },
    }), 201);

    // Adentro sí se ve la tarea: es el link al tablero.
    const interna = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/${incId}`), 200);
    expect(interna.data.tarea?.listaId).toBe(listaId);

    // Para el cliente, en cambio, el nombre interno de la tarea, su espacio y su lista son
    // organización nuestra. Lo único que necesita saber es para cuándo lo estimamos, y eso
    // viaja copiado en la incidencia — de ahí que `fechaEstimada` sea una columna y no un join.
    const detalle = await expectSuccess(await portalA.get(`portal/incidencias/${incId}`), 200);
    expect(detalle.data.fechaEstimada).toBe('2026-11-30');
    expect(detalle.data.tarea).toBeUndefined();
    expect(JSON.stringify(detalle.data)).not.toContain('listaId');

    // Y tampoco en el listado.
    const lista = await expectSuccess(await portalA.get('portal/incidencias'), 200);
    expect(lista.data.every((i: { tarea?: unknown }) => i.tarea === undefined)).toBe(true);
  });

  test('M23.8 - una incidencia cargada desde el portal le avisa al equipo', async ({ adminApi }) => {
    // El aviso al equipo (campana + push) es distinto del mail al cliente: son dos públicos.
    // Se prueba con un alta DESDE EL PORTAL porque al autor no se le notifica lo que acaba de
    // escribir, y en un alta interna el autor es justamente el admin que mira la campana.
    const titulo = `Aviso ${Date.now()}`;
    const creada = await expectSuccess(await portalA.post('portal/incidencias', { data: { titulo } }), 201);
    cleanup.push(`incidencias/${creada.data.id}`);

    const notifs = await expectSuccess(await adminApi.get('notificaciones'), 200);
    const aviso = notifs.data.rows.find((n: { tipo: string; cuerpo: string | null }) =>
      n.tipo === 'incidencia_creada' && n.cuerpo?.includes(titulo));
    expect(aviso).toBeTruthy();
    expect(aviso.url).toBe(`/incidencias?id=${creada.data.id}`);
  });
});
