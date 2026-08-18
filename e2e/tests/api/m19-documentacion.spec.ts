import { test, expect } from '../../fixtures/auth.fixture';
import { API_BASE, APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M19 — Documentación: espacios PROPIOS con matriz de accesos, listas ordenables,
 * documentos (título + HTML saneado + adjuntos), historial de versiones y buscador.
 * Permiso de DOS CAPAS: capability `documentacion:*` Y ver/editar del espacio.
 */
test.describe('M19: Documentación', () => {
  const cleanup: string[] = [];
  let espacioId = 0;
  let listaId = 0;

  test.beforeAll(async ({ playwright, adminTokens }) => {
    const api = await playwright.request.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: { 'x-access-token': adminTokens.accessToken },
    });
    const esp = await api.post(APP_ENDPOINTS.docEspacios, { data: makeNombre('DocEspacio') });
    espacioId = (await esp.json()).data.id;
    cleanup.push(`doc-espacios/${espacioId}`);

    const lista = await api.post(`${APP_ENDPOINTS.documentacion}/espacios/${espacioId}/listas`, {
      data: { nombre: 'Lista E2E', descripcion: 'de prueba' },
    });
    listaId = (await lista.json()).data.id;
    await api.dispose();
  });

  test.afterAll(async () => {
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  test('M19.1 - crear espacio: el creador queda con acceso total y aparece en la home', async ({ adminApi }) => {
    const home = await adminApi.get(`${APP_ENDPOINTS.documentacion}/espacios`);
    const body = await expectSuccess(home, 200);
    const mio = (body.data as Array<{ id: number; puedeEditar: boolean }>).find(e => e.id === espacioId);
    expect(mio).toBeTruthy();
    expect(mio!.puedeEditar).toBe(true);
  });

  test('M19.2 - listas: unicidad por espacio (400) y 409 al eliminar con documentos', async ({ adminApi }) => {
    const dup = await adminApi.post(`${APP_ENDPOINTS.documentacion}/espacios/${espacioId}/listas`, {
      data: { nombre: 'Lista E2E' },
    });
    await expectError(dup, 400);

    const doc = await adminApi.post(`${APP_ENDPOINTS.documentacion}/documentos`, {
      data: { docEspacioId: espacioId, docListaId: listaId, titulo: 'Bloquea el borrado' },
    });
    const creado = (await expectSuccess(doc, 201)).data;

    const del = await adminApi.delete(`${APP_ENDPOINTS.documentacion}/espacios/${espacioId}/listas/${listaId}`);
    await expectError(del, 409);

    await adminApi.delete(`${APP_ENDPOINTS.documentacion}/documentos/${creado.id}`);
  });

  test('M19.3 - documento: HTML saneado al guardar (script fuera, enlaces con rel)', async ({ adminApi }) => {
    const res = await adminApi.post(`${APP_ENDPOINTS.documentacion}/documentos`, {
      data: {
        docEspacioId: espacioId,
        docListaId: listaId,
        titulo: 'Con HTML',
        contenido: '<p>ok</p><script>alert(1)</script><a href="https://ejemplo.com">link</a>',
      },
    });
    const doc = (await expectSuccess(res, 201)).data;

    expect(doc.contenido).not.toContain('<script');
    expect(doc.contenido).toContain('rel="noopener noreferrer"');

    await adminApi.delete(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}`);
  });

  test('M19.3b - alta con adjuntos: los archivos subidos antes del documento se ligan al crearlo', async ({ adminApi, playwright, adminTokens }) => {
    // Contexto aparte para la subida: `adminApi` fija `Content-Type: application/json`, que
    // pisa el boundary del multipart y el backend se queda sin archivo.
    const upload = await playwright.request.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: { 'x-access-token': adminTokens.accessToken },
    });

    // Así trabaja el modal cuando se CREA: el documento todavía no tiene id, así que el
    // archivo se sube suelto (documentoId null) y el alta lo liga con `archivoIds`.
    const subida = await upload.post(`${APP_ENDPOINTS.documentacion}/archivos`, {
      multipart: {
        archivo: { name: 'manual.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nprueba\n') },
      },
    });
    const archivo = (await expectSuccess(subida, 201)).data;   // el body se lee ANTES de cerrar el contexto
    await upload.dispose();
    expect(archivo.documentoId).toBeNull();

    const res = await adminApi.post(`${APP_ENDPOINTS.documentacion}/documentos`, {
      data: {
        docEspacioId: espacioId, docListaId: listaId,
        titulo: 'Alta con adjunto', archivoIds: [archivo.id],
      },
    });
    const doc = (await expectSuccess(res, 201)).data;
    expect(doc.archivos.map((a: { id: number }) => a.id)).toContain(archivo.id);

    // Un segundo documento NO puede quedarse con el adjunto del primero.
    const ladron = await adminApi.post(`${APP_ENDPOINTS.documentacion}/documentos`, {
      data: {
        docEspacioId: espacioId, docListaId: listaId,
        titulo: 'No roba adjuntos', archivoIds: [archivo.id],
      },
    });
    const doc2 = (await expectSuccess(ladron, 201)).data;
    expect(doc2.archivos).toHaveLength(0);

    const relectura = await adminApi.get(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}`);
    expect((await expectSuccess(relectura, 200)).data.archivos).toHaveLength(1);

    await adminApi.delete(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}`);
    await adminApi.delete(`${APP_ENDPOINTS.documentacion}/documentos/${doc2.id}`);
  });

  test('M19.3c - archivoIds inválido → 422', async ({ adminApi }) => {
    const res = await adminApi.post(`${APP_ENDPOINTS.documentacion}/documentos`, {
      data: { docEspacioId: espacioId, docListaId: listaId, titulo: 'Ids raros', archivoIds: ['x'] },
    });
    await expectError(res, 422);
  });

  test('M19.4 - versiones: cada edición archiva la anterior y se puede restaurar', async ({ adminApi }) => {
    const alta = await adminApi.post(`${APP_ENDPOINTS.documentacion}/documentos`, {
      data: { docEspacioId: espacioId, docListaId: listaId, titulo: 'V1', contenido: '<p>uno</p>' },
    });
    const doc = (await expectSuccess(alta, 201)).data;

    await adminApi.put(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}`, { data: { titulo: 'V2' } });
    await adminApi.put(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}`, { data: { contenido: '<p>tres</p>' } });

    const hist = await adminApi.get(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}/versiones`);
    const versiones = (await expectSuccess(hist, 200)).data as Array<{ id: number; titulo: string }>;
    expect(versiones).toHaveLength(2);

    // La más vieja es V1: restaurarla devuelve el título original y NO borra historial.
    const primera = versiones[versiones.length - 1];
    const rest = await adminApi.post(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}/versiones/${primera.id}/restaurar`);
    const restaurado = (await expectSuccess(rest, 200)).data;
    expect(restaurado.titulo).toBe('V1');

    const hist2 = await adminApi.get(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}/versiones`);
    expect(((await hist2.json()).data as unknown[]).length).toBe(3);

    await adminApi.delete(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}`);
  });

  test('M19.5 - buscador: por título y contenido; menos de 2 caracteres → 422', async ({ adminApi }) => {
    const marca = `Zeta${Date.now()}`;
    const alta = await adminApi.post(`${APP_ENDPOINTS.documentacion}/documentos`, {
      data: { docEspacioId: espacioId, docListaId: listaId, titulo: marca, contenido: '<p>contenido buscable</p>' },
    });
    const doc = (await expectSuccess(alta, 201)).data;

    const porTitulo = await adminApi.get(`${APP_ENDPOINTS.documentacion}/buscar?q=${marca}`);
    const res1 = (await expectSuccess(porTitulo, 200)).data as Array<{ id: number }>;
    expect(res1.some(r => r.id === doc.id)).toBeTruthy();

    const porContenido = await adminApi.get(`${APP_ENDPOINTS.documentacion}/buscar?q=buscable`);
    const res2 = (await expectSuccess(porContenido, 200)).data as Array<{ id: number }>;
    expect(res2.some(r => r.id === doc.id)).toBeTruthy();

    const corta = await adminApi.get(`${APP_ENDPOINTS.documentacion}/buscar?q=a`);
    await expectError(corta, 422);

    await adminApi.delete(`${APP_ENDPOINTS.documentacion}/documentos/${doc.id}`);
  });

  test('M19.6 - reordenar listas (drag & drop) persiste el orden', async ({ adminApi }) => {
    const otra = await adminApi.post(`${APP_ENDPOINTS.documentacion}/espacios/${espacioId}/listas`, {
      data: { nombre: `Segunda ${Date.now()}` },
    });
    const segunda = (await expectSuccess(otra, 201)).data;

    const orden = await adminApi.patch(`${APP_ENDPOINTS.documentacion}/espacios/${espacioId}/listas/orden`, {
      data: { ids: [segunda.id, listaId] },
    });
    await expectSuccess(orden, 200);

    const listas = await adminApi.get(`${APP_ENDPOINTS.documentacion}/espacios/${espacioId}/listas`);
    const body = (await expectSuccess(listas, 200)).data as { listas: Array<{ id: number }> };
    expect(body.listas[0].id).toBe(segunda.id);

    await adminApi.delete(`${APP_ENDPOINTS.documentacion}/espacios/${espacioId}/listas/${segunda.id}`);
  });

  test('M19.7 - capa 2: sin acceso al espacio no ve ni edita (403), y la home viene vacía', async ({ authedApi }) => {
    // El usuario de fixture no tiene capability de documentación → 403 de la capa 1.
    const home = await authedApi.get(`${APP_ENDPOINTS.documentacion}/espacios`);
    await expectError(home, 403);

    const listas = await authedApi.get(`${APP_ENDPOINTS.documentacion}/espacios/${espacioId}/listas`);
    await expectError(listas, 403);

    const admin = await authedApi.get(APP_ENDPOINTS.docEspacios);
    await expectError(admin, 403);
  });

  test('M19.8 - sin auth → 401; documento inexistente → 404', async ({ unauthApi, adminApi }) => {
    const sinAuth = await unauthApi.get(`${APP_ENDPOINTS.documentacion}/espacios`);
    await expectError(sinAuth, 401);

    const noExiste = await adminApi.get(`${APP_ENDPOINTS.documentacion}/documentos/99999999`);
    await expectError(noExiste, 404);
  });

  test('M19.9 - eliminar espacio con contenido → 409', async ({ adminApi }) => {
    const del = await adminApi.delete(`${APP_ENDPOINTS.docEspacios}/${espacioId}`);
    await expectError(del, 409);
  });
});
