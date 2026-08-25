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
  let roleId = 0;   // el rol del usuario acotado: M14.9c le agrega `tareas:analisis` en caliente
  let roleLabel = '';
  let tareasApi: APIRequestContext; // usuario con capabilities de tareas pero acceso por espacio acotado

  test.beforeAll(async ({ adminApi }) => {
    const e1 = await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('Espacio T1') });
    espacio1 = (await e1.json()).data.id;
    const e2 = await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('Espacio T2') });
    espacio2 = (await e2.json()).data.id;
    cleanup.push(`espacios/${espacio1}`, `espacios/${espacio2}`);

    // Rol con la capa 1 completa de tareas (SIN tareas:asignar ni tareas:analisis, a propósito).
    const datosRol = makeRole({ capabilities: ['tareas:read', 'tareas:create', 'tareas:update', 'tareas:delete', 'tareas:estado'] });
    roleLabel = datosRol.label as string;
    const rol = await adminApi.post('users/roles', { data: datosRol });
    roleId = (await rol.json()).data.role.id;
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
    // La bitácora ahora audita TODOS los campos, no solo el estado: al crear hay una sola
    // entrada, la del estado inicial, y sin valor anterior.
    expect(tBody.data.historial).toHaveLength(1);
    expect(tBody.data.historial[0].campo).toBe('estado');
    expect(tBody.data.historial[0].valorAnterior).toBeNull();
    expect(tBody.data.historial[0].valorNuevo).toBe('abierta');
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

  test('M14.9b - filtro por espacio (múltiple): recorta conteos y listado, y nunca amplía', async ({ adminApi }) => {
    // Filtrado a UN espacio: solo ese aparece, y el número sigue siendo el del listado.
    const uno = await tareasApi.get(`${APP_ENDPOINTS.tareas}/resumen?f=pendientes&u=todos&e=${espacio1}`);
    const b1 = await expectSuccess(uno, 200);
    for (const g of b1.data.grupos) expect(g.espacioId).toBe(espacio1);
    expect(b1.data.espaciosFiltro).toEqual([espacio1]);
    const listadas = b1.data.grupos.flatMap((g: { listas: Array<{ tareas: unknown[] }> }) => g.listas).reduce(
      (acc: number, l: { tareas: unknown[] }) => acc + l.tareas.length, 0,
    );
    expect(b1.data.conteos.pendientes).toBe(listadas);
    // El catálogo del selector trae TODOS los visibles, no los filtrados.
    const ids = b1.data.espacios.map((e: { id: number }) => e.id);
    expect(ids).toEqual(expect.arrayContaining([espacio1, espacio2]));

    // Los dos a la vez = lo mismo que sin filtro.
    const dos = await expectSuccess(
      await tareasApi.get(`${APP_ENDPOINTS.tareas}/resumen?f=pendientes&u=todos&e=${espacio1},${espacio2}`), 200,
    );
    const sinFiltro = await expectSuccess(
      await tareasApi.get(`${APP_ENDPOINTS.tareas}/resumen?f=pendientes&u=todos`), 200,
    );
    expect(dos.data.conteos.pendientes).toBe(sinFiltro.data.conteos.pendientes);

    // Un espacio AJENO en el filtro no abre nada: se descarta y el resumen queda como estaba.
    const ajeno = await adminApi.post(APP_ENDPOINTS.espacios, { data: makeNombre('Espacio T3 ajeno') });
    const espacioAjeno = (await ajeno.json()).data.id;
    cleanup.push(`espacios/${espacioAjeno}`);
    const colado = await expectSuccess(
      await tareasApi.get(`${APP_ENDPOINTS.tareas}/resumen?f=pendientes&u=todos&e=${espacioAjeno}`), 200,
    );
    expect(colado.data.espaciosFiltro).toEqual([]);
    for (const g of colado.data.grupos) expect([espacio1, espacio2]).toContain(g.espacioId);
  });

  test('M14.9c - análisis: capability PROPIA, bloques completos, alcance por espacio y rango', async ({ adminApi }) => {
    // `tareas:read` NO habilita el análisis: son permisos distintos a propósito (la pantalla
    // muestra métricas del equipo, no el tablero).
    await expectError(await tareasApi.get(`${APP_ENDPOINTS.tareas}/analisis`), 403);

    // Se le agrega la capability al rol: el cache de capabilities se invalida al guardarlo,
    // así que el MISMO token pasa a entrar sin volver a loguearse.
    await expectSuccess(await adminApi.put(`users/roles/${roleId}`, {
      data: {
        label: roleLabel,
        capabilities: [
          'tareas:read', 'tareas:create', 'tareas:update', 'tareas:delete', 'tareas:estado',
          'tareas:analisis',
        ],
      },
    }), 200);

    const base = (await expectSuccess(await tareasApi.get(`${APP_ENDPOINTS.tareas}/analisis`), 200)).data;

    // Los siete bloques de la pantalla vienen en UNA sola llamada.
    for (const k of ['equipo', 'porLista', 'porEspacio', 'rango', 'serie', 'antiguedad', 'prioridad']) {
      expect(base).toHaveProperty(k);
    }
    // Sin rango pedido, el default es el MES ACTUAL completo (del 1 al último día).
    const hoy = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(base.rango.desde).toBe(`${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-01`);
    expect(base.rango.hasta).toBe(
      `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate())}`,
    );
    // La serie anual siempre son 12 meses, aunque no haya datos.
    expect(base.serie.creadas).toHaveLength(12);
    expect(base.serie.completadas).toHaveLength(12);
    // El usuario acotado solo analiza SUS espacios.
    for (const f of base.porEspacio) expect([espacio1, espacio2]).toContain(f.espacioId);

    // Por lista incluye las COMPLETADAS (el resumen del módulo solo mira pendientes).
    expect(base.porLista.length).toBeGreaterThan(0);
    for (const f of base.porLista) {
      expect(f).toHaveProperty('estados.completada');
      const suma = Object.values(f.estados as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(suma).toBe(f.total);
    }

    // Filtro por espacio: recorta TODOS los bloques, no solo uno.
    const filtrado = (await expectSuccess(
      await tareasApi.get(`${APP_ENDPOINTS.tareas}/analisis?e=${espacio1}`), 200,
    )).data;
    expect(filtrado.espaciosFiltro).toEqual([espacio1]);
    for (const f of filtrado.porEspacio) expect(f.espacioId).toBe(espacio1);
    for (const f of filtrado.porLista) expect(f.espacioId).toBe(espacio1);

    // Una tarea completada HOY aparece en el rango de hoy, con quién la cerró.
    const lista = await tareasApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`, { data: makeNombre('Lista analisis') });
    const listaId = (await lista.json()).data.id;
    const tarea = await tareasApi.post(APP_ENDPOINTS.tareas, { data: { listaId, nombre: 'Cerrada hoy', fechaVencimiento: '2030-01-01' } });
    const tareaId = (await expectSuccess(tarea, 201)).data.id;
    await expectSuccess(await tareasApi.patch(`${APP_ENDPOINTS.tareas}/${tareaId}/estado`, { data: { estado: 'completada' } }), 200);

    const dia = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
    const rango = (await expectSuccess(
      await tareasApi.get(`${APP_ENDPOINTS.tareas}/analisis?desde=${dia}&hasta=${dia}`), 200,
    )).data.rango;
    expect(rango.completadas).toBeGreaterThanOrEqual(1);
    expect(rango.aTiempo).toBeGreaterThanOrEqual(1);   // vence en 2030
    // El detalle tarea por tarea NO se sirve: la pantalla muestra agregados.
    expect(rango).not.toHaveProperty('tareas');
    // Carga por lista del período: pendientes de hoy + cerradas del rango, y total = la suma.
    const enLista = rango.porLista.find((f: { listaId: number }) => f.listaId === listaId);
    expect(enLista.realizadas).toBe(1);
    expect(enLista.pendientes).toBe(0);        // la única tarea de la lista quedó completada
    expect(enLista.total).toBe(1);
    expect(enLista.espacioId).toBe(espacio1);
    for (const f of rango.porLista) expect(f.total).toBe(f.pendientes + f.realizadas);
    // Viene ordenada por total descendente.
    const totales = rango.porLista.map((f: { total: number }) => f.total);
    expect([...totales].sort((a: number, b: number) => b - a)).toEqual(totales);
    // Quién cerró sigue saliendo de la bitácora.
    expect(rango.porUsuario.length).toBeGreaterThanOrEqual(1);

    // Un rango invertido se endereza en vez de devolver vacío.
    const invertido = (await expectSuccess(
      await tareasApi.get(`${APP_ENDPOINTS.tareas}/analisis?desde=${dia}&hasta=2020-01-01`), 200,
    )).data.rango;
    expect(invertido.desde).toBe('2020-01-01');
    expect(invertido.hasta).toBe(dia);

    // Basura en las fechas → 422 (no un rango inventado en silencio).
    await expectError(await tareasApi.get(`${APP_ENDPOINTS.tareas}/analisis?desde=pepe`), 422);
  });

  test('M14.10 - una lista con tareas no se elimina → 409; tarea inexistente → 404 real', async () => {
    const listas = await tareasApi.get(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`);
    const conTareas = (await listas.json()).data.listas.find((l: { total: number }) => l.total > 0);
    const del = await tareasApi.delete(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas/${conTareas.id}`);
    const body = await expectError(del, 409);
    expect(body.message).toContain('tarea(s)');

    await expectError(await tareasApi.delete(`${APP_ENDPOINTS.tareas}/999999`), 404);
  });

  test('M14.13 - la edición RÁPIDA deja rastro en el historial (antes no anotaba nada)', async () => {
    const lista = await tareasApi.post(`${APP_ENDPOINTS.tareas}/espacios/${espacio1}/listas`, { data: makeNombre('Lista audit') });
    const listaId = (await lista.json()).data.id;
    const tarea = await tareasApi.post(APP_ENDPOINTS.tareas, { data: { listaId, nombre: 'Auditoría rápida' } });
    const tareaId = (await expectSuccess(tarea, 201)).data.id;

    // Edición rápida: solo cambia el vencimiento. Antes esto no dejaba ninguna huella.
    await expectSuccess(await tareasApi.patch(`${APP_ENDPOINTS.tareas}/${tareaId}/rapida`, {
      data: { nombre: 'Auditoría rápida', fechaVencimiento: '2030-06-15' },
    }), 200);

    const detalle = (await expectSuccess(await tareasApi.get(`${APP_ENDPOINTS.tareas}/${tareaId}`), 200)).data;
    const cambio = detalle.historial.find((h: { campo: string }) => h.campo === 'fechaVencimiento');
    expect(cambio).toBeTruthy();
    expect(cambio.valorNuevo).toBe('2030-06-15');
    expect(cambio.usuario).toBeTruthy();   // quién lo cambió: era justamente lo que faltaba
  });

  test('M14.12 - adjuntos: una IMAGEN sube como adjunto con destino=adjunto, y como contenido sin él', async ({ adminTokens, playwright }) => {
    // Contexto propio: los fixtures fijan Content-Type JSON y eso rompe el multipart.
    const up = await playwright.request.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: { 'x-access-token': adminTokens.accessToken },
    });
    // PNG mínimo válido (firma + IHDR): las defensas miran el CONTENIDO, no el nombre.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const subir = (destino?: string) => up.post(`${APP_ENDPOINTS.tareas}/archivos`, {
      multipart: {
        archivo: { name: 'foto.png', mimeType: 'image/png', buffer: png },
        ...(destino ? { destino } : {}),
      },
    });

    // Sin `destino` (o con 'editor') una imagen es contenido del cuerpo.
    expect((await expectSuccess(await subir(), 201)).data.tipo).toBe('imagen');
    expect((await expectSuccess(await subir('editor'), 201)).data.tipo).toBe('imagen');
    // Con 'adjunto' queda como archivo, que es lo que lista la ficha de la tarea.
    expect((await expectSuccess(await subir('adjunto'), 201)).data.tipo).toBe('archivo');

    // La clasificación cambia; las DEFENSAS no: un .png que no es imagen sigue afuera…
    await expectError(await up.post(`${APP_ENDPOINTS.tareas}/archivos`, {
      multipart: {
        archivo: { name: 'falso.png', mimeType: 'image/png', buffer: Buffer.from('no soy una imagen') },
        destino: 'adjunto',
      },
    }), 400);
    // …y el límite de 5 MB de las imágenes se aplica igual al adjuntarlas.
    await expectError(await up.post(`${APP_ENDPOINTS.tareas}/archivos`, {
      multipart: {
        archivo: { name: 'grande.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]) },
        destino: 'adjunto',
      },
    }), 400);

    await up.dispose();
  });

  test('M14.11 - capability gating: el fixture (sin tareas:read) → 403', async ({ authedApi }) => {
    const res = await authedApi.get(`${APP_ENDPOINTS.tareas}/espacios`);
    const body = await expectError(res, 403);
    expect(body.message).toContain('tareas:read');
  });

  test('M14.14 - clonar una tarea: copia los datos, resetea el estado y numera el nombre', async ({ adminApi }) => {
    const lista = await adminApi.post(`tareas/espacios/${espacio1}/listas`, { data: makeNombre('Lista Clon') });
    const listaId = (await lista.json()).data.id;
    const orig = await adminApi.post(APP_ENDPOINTS.tareas, {
      data: { listaId, nombre: 'Tarea original', prioridad: 'rojo', descripcion: '<p>cuerpo</p>', estado: 'completada' },
    });
    const origId = (await orig.json()).data.id;

    const c1 = await expectSuccess(await adminApi.post(`${APP_ENDPOINTS.tareas}/${origId}/clonar`), 201);
    expect(c1.data.nombre).toBe('Tarea original (copia)');
    // El estado NO se hereda: clonar una tarea completada es para volver a hacerla, así que
    // heredar «completada» dejaría el clon terminado antes de empezar.
    expect(c1.data.estado).toBe('abierta');
    expect(c1.data.prioridad).toBe('rojo');
    expect(c1.data.descripcion).toContain('cuerpo');
    // El historial del original no se copia: el clon arranca con su propia creación.
    expect(c1.data.historial).toHaveLength(1);

    // Clonar de nuevo numera en vez de fallar: repetir el clon es normal.
    const c2 = await expectSuccess(await adminApi.post(`${APP_ENDPOINTS.tareas}/${origId}/clonar`), 201);
    expect(c2.data.nombre).toBe('Tarea original (copia 2)');

    // Con lista destino explícita el clon se va a esa lista.
    const otra = await adminApi.post(`tareas/espacios/${espacio1}/listas`, { data: makeNombre('Lista Destino') });
    const otraId = (await otra.json()).data.id;
    const c3 = await expectSuccess(await adminApi.post(`${APP_ENDPOINTS.tareas}/${origId}/clonar`, { data: { listaId: otraId } }), 201);
    expect(c3.data.listaId).toBe(otraId);
    // En una lista vacía no hay con qué chocar, así que no hace falta numerar.
    expect(c3.data.nombre).toBe('Tarea original (copia)');

    await expectError(await adminApi.post(`${APP_ENDPOINTS.tareas}/999999/clonar`), 404);
  });

  test('M14.15 - clonar una lista arrastra sus tareas, todas abiertas', async ({ adminApi }) => {
    const lista = await adminApi.post(`tareas/espacios/${espacio1}/listas`, { data: makeNombre('Lista Plantilla') });
    const origen = (await lista.json()).data;
    for (const [nombre, estado] of [['Paso 1', 'abierta'], ['Paso 2', 'completada'], ['Paso 3', 'en_progreso']]) {
      await adminApi.post(APP_ENDPOINTS.tareas, { data: { listaId: origen.id, nombre, estado } });
    }

    const clon = await expectSuccess(await adminApi.post(`tareas/espacios/${espacio1}/listas/${origen.id}/clonar`), 201);
    expect(clon.data.lista.nombre).toBe(`${origen.nombre} (copia)`);
    expect(clon.data.tareas).toBe(3);
    expect(clon.data.errores).toHaveLength(0);

    // Las tareas conservan su nombre (poner «(copia)» a 40 tareas sería ruido) pero arrancan
    // TODAS abiertas: una plantilla con la mitad de los ítems hechos no sirve de plantilla.
    const dentro = await expectSuccess(await adminApi.get(`tareas/espacios/${espacio1}/listas/${clon.data.lista.id}/tareas`), 200);
    const filas = dentro.data.tareas ?? dentro.data;
    expect(filas).toHaveLength(3);
    expect(filas.map((f: { nombre: string }) => f.nombre).sort()).toEqual(['Paso 1', 'Paso 2', 'Paso 3']);
    for (const f of filas) expect(f.estado).toBe('abierta');

    // `conTareas: false` clona solo el contenedor, y el nombre se numera.
    const solo = await expectSuccess(
      await adminApi.post(`tareas/espacios/${espacio1}/listas/${origen.id}/clonar`, { data: { conTareas: false } }), 201);
    expect(solo.data.tareas).toBe(0);
    expect(solo.data.lista.nombre).toBe(`${origen.nombre} (copia 2)`);

    await expectError(await adminApi.post(`tareas/espacios/${espacio1}/listas/999999/clonar`), 404);
    // Capa 2: el usuario de tareas no puede editar el espacio 2, así que no puede clonar ahí.
    const ajena = await adminApi.post(`tareas/espacios/${espacio2}/listas`, { data: makeNombre('Lista Ajena') });
    const ajenaId = (await ajena.json()).data.id;
    await expectError(await tareasApi.post(`tareas/espacios/${espacio2}/listas/${ajenaId}/clonar`), 403);
  });
});
