import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M22 — Incidencias: alta desde el sistema interno, derivación de servicios, el vínculo con
 * una tarea y —lo más delicado— que el estado de la tarea baje a la incidencia por TODAS las
 * rutas por las que una tarea puede cambiar de estado.
 */
// SERIAL: es una historia sola (se carga la incidencia, se convierte en tarea, se la mueve).
test.describe.configure({ mode: 'serial' });

test.describe('M22: Incidencias', () => {
  const cleanup: string[] = [];
  let clienteId = 0;
  let servicioPropio = 0;
  let servicioAjeno = 0;
  let espacioId = 0;
  let listaId = 0;

  test.beforeAll(async ({ adminApi }) => {
    const cli = await adminApi.post(APP_ENDPOINTS.clientes, { data: makeNombre('Cliente Inc') });
    clienteId = (await cli.json()).data.id;
    cleanup.push(`clientes/${clienteId}`);

    const s1 = await adminApi.post(APP_ENDPOINTS.servicios, { data: makeNombre('Servicio Propio') });
    servicioPropio = (await s1.json()).data.id;
    const s2 = await adminApi.post(APP_ENDPOINTS.servicios, { data: makeNombre('Servicio Ajeno') });
    servicioAjeno = (await s2.json()).data.id;
    cleanup.push(`servicios/${servicioPropio}`, `servicios/${servicioAjeno}`);

    const esp = await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('Espacio Inc') });
    espacioId = (await esp.json()).data.id;
    cleanup.push(`espacios/${espacioId}`);
    const lista = await adminApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacioId}/listas`, { data: makeNombre('Entrantes') });
    listaId = (await lista.json()).data.id;
  });

  test.afterAll(async () => {
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  test('M22.1 - servicios elegibles: se derivan de abonos ACTIVOS + proyectos, y pueden ser ninguno', async ({ adminApi }) => {
    // Los abonos nacen INACTIVOS, así que recién creado el cliente no tiene ningún servicio
    // derivable. Ese caso existe de verdad y es el motivo de que `servicioId` sea opcional.
    const vacio = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/servicios/${clienteId}`), 200);
    expect(vacio.data).toEqual([]);

    const abono = await adminApi.post(APP_ENDPOINTS.abonos, {
      data: { clienteId, servicioId: servicioPropio, moneda: 'ARS', precio: 1000, fechaInicio: '2026-01-01', periodoMeses: 6 },
    });
    const abonoId = (await abono.json()).data.id;
    cleanup.push(`abonos/${abonoId}`);
    // Inactivo todavía → sigue sin derivar nada.
    expect((await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/servicios/${clienteId}`), 200)).data).toEqual([]);

    await adminApi.patch(`${APP_ENDPOINTS.abonos}/${abonoId}/active`);
    const conAbono = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/servicios/${clienteId}`), 200);
    expect(conAbono.data.map((s: { id: number }) => s.id)).toEqual([servicioPropio]);
  });

  test('M22.2 - alta: con servicio propio, como consulta general, y rechazo del servicio ajeno', async ({ adminApi }) => {
    const conServicio = await expectSuccess(await adminApi.post(APP_ENDPOINTS.incidencias, {
      data: { clienteId, servicioId: servicioPropio, titulo: 'No carga el checkout', descripcion: 'Da error al pagar.' },
    }), 201);
    cleanup.push(`incidencias/${conServicio.data.id}`);
    expect(conServicio.data.estado).toBe('nueva');
    expect(conServicio.data.servicio.id).toBe(servicioPropio);
    // El alta escribe la fila de bitácora, que es también el outbox del mail.
    expect(conServicio.data.historial.map((h: { evento: string }) => h.evento)).toEqual(['creada']);

    // `servicioId` ausente = consulta general: es la salida para el cliente sin servicios.
    const general = await expectSuccess(await adminApi.post(APP_ENDPOINTS.incidencias, {
      data: { clienteId, titulo: 'Consulta general' },
    }), 201);
    cleanup.push(`incidencias/${general.data.id}`);
    expect(general.data.servicioId).toBeNull();

    // Un servicio que NO es de este cliente se rechaza, aunque exista.
    await expectError(await adminApi.post(APP_ENDPOINTS.incidencias, {
      data: { clienteId, servicioId: servicioAjeno, titulo: 'Servicio ajeno' },
    }), 400);

    // Sin título no hay incidencia.
    await expectError(await adminApi.post(APP_ENDPOINTS.incidencias, { data: { clienteId, titulo: '' } }), 422);
  });

  test('M22.3 - el listado pone las TERMINADAS al fondo', async ({ adminApi }) => {
    const nueva = await expectSuccess(await adminApi.post(APP_ENDPOINTS.incidencias, {
      data: { clienteId, titulo: 'La última que entra' },
    }), 201);
    cleanup.push(`incidencias/${nueva.data.id}`);

    const lista = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}?clienteId=${clienteId}`), 200);
    const terminadas = lista.data.map((i: { estado: string }) => i.estado === 'resuelta');
    // Todas las abiertas antes que cualquier resuelta: el array ordenado tiene que ser igual.
    expect([...terminadas].sort((a: boolean, b: boolean) => Number(a) - Number(b))).toEqual(terminadas);
  });

  test('M22.4 - crear tarea desde la incidencia: las vincula, y dos veces da 409', async ({ adminApi }) => {
    const inc = await expectSuccess(await adminApi.post(APP_ENDPOINTS.incidencias, {
      data: { clienteId, titulo: 'Se cae el sitio', descripcion: 'Desde ayer.' },
    }), 201);
    const incId = inc.data.id;
    cleanup.push(`incidencias/${incId}`);

    const vinculada = await expectSuccess(
      await adminApi.post(`${APP_ENDPOINTS.incidencias}/${incId}/tarea`, { data: { listaId } }), 201);
    expect(vinculada.data.tareaId).toBeTruthy();
    expect(vinculada.data.tarea.nombre).toBe('Se cae el sitio');
    // `abierta → nueva`: que exista una tarea no significa que alguien la empezó.
    expect(vinculada.data.estado).toBe('nueva');

    // El UNIQUE de `tareaId` es lo que impide el doble vínculo si se aprieta dos veces.
    await expectError(await adminApi.post(`${APP_ENDPOINTS.incidencias}/${incId}/tarea`, { data: { listaId } }), 409);
  });

  test('M22.5 - el estado de la TAREA baja a la incidencia por TODAS las rutas', async ({ adminApi }) => {
    const inc = await expectSuccess(await adminApi.post(APP_ENDPOINTS.incidencias, {
      data: { clienteId, titulo: 'Propagación' },
    }), 201);
    const incId = inc.data.id;
    cleanup.push(`incidencias/${incId}`);
    const vinc = await expectSuccess(
      await adminApi.post(`${APP_ENDPOINTS.incidencias}/${incId}/tarea`, { data: { listaId } }), 201);
    const tareaId = vinc.data.tareaId;

    const estado = async (): Promise<string> =>
      (await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/${incId}`), 200)).data.estado;

    // Ruta 1: PATCH de estado suelto. El mapeo es 5→3: el kanban interno no se le muestra
    // al cliente, así que «pausada» y «en revisión» le llegan como «en progreso».
    for (const [estadoTarea, esperado] of [
      ['en_progreso', 'en_progreso'], ['pausada', 'en_progreso'],
      ['en_revision', 'en_progreso'], ['completada', 'resuelta'],
    ]) {
      await expectSuccess(await adminApi.patch(`${APP_ENDPOINTS.tareas}/${tareaId}/estado`, { data: { estado: estadoTarea } }), 200);
      expect(await estado()).toBe(esperado);
    }

    // Ruta 2: PUT completo de la tarea (pasa por `registrarCambios`, no por `registrarEstado`).
    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.tareas}/${tareaId}`, {
      data: { nombre: 'Propagación', estado: 'en_progreso' },
    }), 200);
    expect(await estado()).toBe('en_progreso');

    // Ruta 3: lote.
    await expectSuccess(await adminApi.patch(`${APP_ENDPOINTS.tareas}/lote/estado`, {
      data: { ids: [tareaId], estado: 'completada' },
    }), 200);
    expect(await estado()).toBe('resuelta');
  });

  test('M22.6 - NINGÚN estado es terminal: reabrir la tarea reabre el reclamo', async ({ adminApi }) => {
    const inc = await expectSuccess(await adminApi.post(APP_ENDPOINTS.incidencias, {
      data: { clienteId, titulo: 'Reapertura' },
    }), 201);
    const incId = inc.data.id;
    cleanup.push(`incidencias/${incId}`);
    const vinc = await expectSuccess(
      await adminApi.post(`${APP_ENDPOINTS.incidencias}/${incId}/tarea`, { data: { listaId } }), 201);
    const tareaId = vinc.data.tareaId;

    await expectSuccess(await adminApi.patch(`${APP_ENDPOINTS.tareas}/${tareaId}/estado`, { data: { estado: 'completada' } }), 200);
    const resuelta = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/${incId}`), 200);
    expect(resuelta.data.estado).toBe('resuelta');
    expect(resuelta.data.resueltaAt).toBeTruthy();

    // Se reabre la tarea porque en realidad no estaba resuelta. El cliente TIENE que verlo:
    // es justo el caso en el que más le importa enterarse. Antes había un estado `cerrada`
    // que cortaba esta cadena; se sacó porque se pisaba con `resuelta`.
    await expectSuccess(await adminApi.patch(`${APP_ENDPOINTS.tareas}/${tareaId}/estado`, { data: { estado: 'en_progreso' } }), 200);
    const final = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/${incId}`), 200);
    expect(final.data.estado).toBe('en_progreso');
    // Y el sello de resolución se limpia: decir que se resolvió tal día ya no es cierto.
    expect(final.data.resueltaAt).toBeNull();
  });

  test('M22.9 - la fecha de vencimiento de la tarea es la fecha estimada de la incidencia', async ({ adminApi }) => {
    const inc = await expectSuccess(await adminApi.post(APP_ENDPOINTS.incidencias, {
      data: { clienteId, titulo: 'Con fecha' },
    }), 201);
    const incId = inc.data.id;
    cleanup.push(`incidencias/${incId}`);

    // 1. Se carga al crear la tarea, sin tener que entrar después a la tarea.
    const vinc = await expectSuccess(await adminApi.post(`${APP_ENDPOINTS.incidencias}/${incId}/tarea`, {
      data: { listaId, fechaVencimiento: '2026-11-20' },
    }), 201);
    expect(vinc.data.fechaEstimada).toBe('2026-11-20');

    // 2. Y sigue a la tarea cuando alguien la corre después: el enganche está en
    //    `registrarCambios`, que es por donde pasan la edición rápida y el PUT completo.
    await expectSuccess(await adminApi.patch(`${APP_ENDPOINTS.tareas}/${vinc.data.tareaId}/rapida`, {
      data: { nombre: 'Con fecha', fechaVencimiento: '2026-12-05' },
    }), 200);
    const corrida = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/${incId}`), 200);
    expect(corrida.data.fechaEstimada).toBe('2026-12-05');

    // 3. Borrarla en la tarea la borra en la incidencia: no dejamos en pie una fecha estimada
    //    que ya nadie sostiene. (Se borra con el PUT completo, que es el que acepta vaciarla:
    //    la edición rápida es un PATCH y un campo ausente ahí significa «no lo toques».)
    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.tareas}/${vinc.data.tareaId}`, {
      data: { nombre: 'Con fecha' },
    }), 200);
    const sinFecha = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/${incId}`), 200);
    expect(sinFecha.data.fechaEstimada).toBeNull();
  });

  test('M22.7 - borrar la tarea DESVINCULA en vez de dejar la incidencia colgada', async ({ adminApi }) => {
    // El borrado de tareas es soft-delete y no escribe estado, así que no pasa por la
    // propagación: sin un desenganche explícito la incidencia quedaría apuntando a una tarea
    // invisible y con el estado congelado para siempre (las tareas no tienen restore).
    for (const modo of ['individual', 'lote'] as const) {
      const inc = await expectSuccess(await adminApi.post(APP_ENDPOINTS.incidencias, {
        data: { clienteId, titulo: `Desvincular ${modo}` },
      }), 201);
      cleanup.push(`incidencias/${inc.data.id}`);
      const vinc = await expectSuccess(
        await adminApi.post(`${APP_ENDPOINTS.incidencias}/${inc.data.id}/tarea`, { data: { listaId } }), 201);

      if (modo === 'individual') await adminApi.delete(`${APP_ENDPOINTS.tareas}/${vinc.data.tareaId}`);
      else await adminApi.post(`${APP_ENDPOINTS.tareas}/lote/eliminar`, { data: { ids: [vinc.data.tareaId] } });

      const suelta = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.incidencias}/${inc.data.id}`), 200);
      expect(suelta.data.tareaId).toBeNull();
      expect(suelta.data.historial[0].detalle).toContain('Se eliminó la tarea vinculada');
    }
  });

  test('M22.8 - capability gating: el fixture (sin incidencias:read) → 403', async ({ authedApi, unauthApi }) => {
    await expectError(await unauthApi.get(APP_ENDPOINTS.incidencias), 401);
    await expectError(await authedApi.get(APP_ENDPOINTS.incidencias), 403);
    await expectError(await authedApi.post(APP_ENDPOINTS.incidencias, { data: { clienteId, titulo: 'x' } }), 403);
  });
});
