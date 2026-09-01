import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M11 — Abonos: ABM, actualización de precios (preview/aplicar idempotente),
 * facturación mensual con montos congelados y anulación auditada.
 */
test.describe('M11: Abonos', () => {
  const cleanup: string[] = [];
  let clienteId = 0;
  let servicioId = 0;

  /** UUID simple para operationIds de prueba. */
  const opId = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  test.beforeAll(async ({ adminApi }) => {
    const cliente = await adminApi.post(APP_ENDPOINTS.clientes, { data: makeNombre('Cliente Abonos') });
    clienteId = (await cliente.json()).data.id;
    cleanup.push(`clientes/${clienteId}`);
    const servicio = await adminApi.post(APP_ENDPOINTS.servicios, { data: makeNombre('Servicio Abonos') });
    servicioId = (await servicio.json()).data.id;
    cleanup.push(`servicios/${servicioId}`);
  });

  test.afterAll(async () => {
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  /** Alta de un abono ACTIVO de prueba. */
  async function createAbono(adminApi: import('@playwright/test').APIRequestContext, extra: Record<string, unknown> = {}) {
    const res = await adminApi.post(APP_ENDPOINTS.abonos, {
      data: {
        clienteId, servicioId, moneda: 'ARS', precio: 10000,
        fechaInicio: '2025-01-01', periodoMeses: 6, activo: true, ...extra,
      },
    });
    const body = await expectSuccess(res, 201);
    cleanup.push(`abonos/${body.data.id}`);
    return body.data;
  }

  test('M11.1 - crear abono → 201 con cliente/servicio y días calculados', async ({ adminApi }) => {
    const abono = await createAbono(adminApi);
    expect(abono.cliente).toBeTruthy();
    expect(abono.servicio).toBeTruthy();
    expect(abono).toHaveProperty('diasParaActualizar');
  });

  test('M11.2 - un abono nace INACTIVO por defecto', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.abonos, {
      data: { clienteId, servicioId, moneda: 'USD', precio: 100, fechaInicio: '2026-01-01', periodoMeses: 12 },
    });
    const body = await expectSuccess(res, 201);
    cleanup.push(`abonos/${body.data.id}`);
    expect(body.data.activo).toBe(false);
  });

  test('M11.3 - cliente inexistente → 400', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.abonos, {
      data: { clienteId: 99999999, servicioId, moneda: 'ARS', precio: 1, fechaInicio: '2026-01-01', periodoMeses: 12 },
    });
    const body = await expectError(res, 400);
    expect(body.message).toContain('cliente');
  });

  test('M11.4 - actualización ARS por %: redondeo al múltiplo configurado + historial', async ({ adminApi }) => {
    const abono = await createAbono(adminApi, { precio: 10150 });
    // 10150 * 1.10 = 11165 → redondeado a centena: 11200.
    const preview = await adminApi.post(`${APP_ENDPOINTS.abonos}/actualizar/preview`, {
      data: { ids: [abono.id], porcentaje: '10' },
    });
    const pBody = await expectSuccess(preview, 200);
    expect(Number(pBody.data.rows[0].precioNuevo)).toBe(11200);

    const apply = await adminApi.post(`${APP_ENDPOINTS.abonos}/actualizar`, {
      data: { ids: [abono.id], porcentaje: '10', operationId: opId() },
    });
    await expectSuccess(apply, 200);

    const hist = await adminApi.get(`${APP_ENDPOINTS.abonos}/${abono.id}/actualizaciones`);
    const hBody = await expectSuccess(hist, 200);
    expect(hBody.data).toHaveLength(1);
    expect(hBody.data[0].tipo).toBe('porcentaje');
    // La fecha de actualización queda en el día 1 del mes corriente (regla del legado).
    expect(hBody.data[0].fecha.endsWith('-01')).toBeTruthy();
  });

  test('M11.5 - idempotencia: re-aplicar el mismo operationId NO duplica el aumento', async ({ adminApi }) => {
    const abono = await createAbono(adminApi, { precio: 10000 });
    const operation = opId();
    const payload = { ids: [abono.id], porcentaje: '20', operationId: operation };

    await expectSuccess(await adminApi.post(`${APP_ENDPOINTS.abonos}/actualizar`, { data: payload }), 200);
    const second = await adminApi.post(`${APP_ENDPOINTS.abonos}/actualizar`, { data: payload });
    const sBody = await expectSuccess(second, 200);
    expect(sBody.data.idempotente).toBe(true);

    const after = await adminApi.get(`${APP_ENDPOINTS.abonos}/${abono.id}`);
    expect(Number((await after.json()).data.precio)).toBe(12000); // una sola vez, no compuesto
  });

  test('M11.6 - actualización USD: el precio en dólares se mantiene y se registra la cotización', async ({ adminApi }) => {
    const abono = await createAbono(adminApi, { moneda: 'USD', precio: 300 });
    const apply = await adminApi.post(`${APP_ENDPOINTS.abonos}/actualizar`, {
      data: { ids: [abono.id], cotizacion: '1200', operationId: opId() },
    });
    const body = await expectSuccess(apply, 200);
    expect(Number(body.data.rows[0].precioNuevo)).toBe(300);
    expect(Number(body.data.rows[0].cotizacion)).toBe(1200);
    expect(Number(body.data.rows[0].precioPesos)).toBe(360000);
  });

  test('M11.7 - un abono inactivo NO se actualiza (se descarta del lote)', async ({ adminApi }) => {
    const inactivo = await createAbono(adminApi, { activo: false });
    const res = await adminApi.post(`${APP_ENDPOINTS.abonos}/actualizar/preview`, {
      data: { ids: [inactivo.id], porcentaje: '10' },
    });
    const body = await expectError(res, 400);
    expect(body.message).toContain('activos');
  });

  test('M11.8 - facturar congela el monto; re-facturar el período omite; anular permite re-facturar', async ({ adminApi }) => {
    const abono = await createAbono(adminApi, { precio: 5000 });
    const periodo = { anio: 2026, mes: 1 };

    // 1. Facturar.
    const first = await adminApi.post(`${APP_ENDPOINTS.abonos}/facturar`, {
      data: { ids: [abono.id], ...periodo, operationId: opId() },
    });
    const fBody = await expectSuccess(first, 200);
    expect(fBody.data.facturados).toBe(1);
    expect(Number(fBody.data.total)).toBe(5000);

    // 2. Re-facturar el mismo período → 0 facturados, 1 omitido.
    const second = await adminApi.post(`${APP_ENDPOINTS.abonos}/facturar`, {
      data: { ids: [abono.id], ...periodo, operationId: opId() },
    });
    const sBody = await expectSuccess(second, 200);
    expect(sBody.data.facturados).toBe(0);
    expect(sBody.data.omitidos).toBe(1);

    // 3. Anular (auditada, con motivo obligatorio) y re-facturar.
    const list = await adminApi.get(`${APP_ENDPOINTS.facturaciones}?anio=2026&mes=1&abonoId=${abono.id}`);
    const factId = (await list.json()).data.rows[0].id;

    const sinMotivo = await adminApi.post(`${APP_ENDPOINTS.facturaciones}/${factId}/anular`, { data: {} });
    await expectError(sinMotivo, 422);

    const anular = await adminApi.post(`${APP_ENDPOINTS.facturaciones}/${factId}/anular`, {
      data: { motivo: 'Facturación de prueba E2E' },
    });
    const aBody = await expectSuccess(anular, 200);
    expect(aBody.data.motivoAnulacion).toBe('Facturación de prueba E2E');

    const third = await adminApi.post(`${APP_ENDPOINTS.abonos}/facturar`, {
      data: { ids: [abono.id], ...periodo, operationId: opId() },
    });
    expect((await third.json()).data.facturados).toBe(1);
  });

  test('M11.15 - el abono que toca actualizar HOY cuenta como vencido, no como próximo', async ({ adminApi }) => {
    // Se construye `fechaUltimaActualizacion` para que la próxima caiga exactamente hoy,
    // ayer y mañana (período de 1 mes): son los tres días del borde.
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const baseParaVencerEn = (offsetDias: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDias);
      d.setMonth(d.getMonth() - 1);
      return iso(d);
    };

    const hoyMismo = await createAbono(adminApi, {
      descripcion: 'Vence hoy', periodoMeses: 1, fechaUltimaActualizacion: baseParaVencerEn(0),
    });
    const ayer = await createAbono(adminApi, {
      descripcion: 'Vencido ayer', periodoMeses: 1, fechaUltimaActualizacion: baseParaVencerEn(-1),
    });
    const manana = await createAbono(adminApi, {
      descripcion: 'Vence mañana', periodoMeses: 1, fechaUltimaActualizacion: baseParaVencerEn(1),
    });

    const dias = async (id: number): Promise<number> => {
      const res = await adminApi.get(`${APP_ENDPOINTS.abonos}/${id}`);
      return (await expectSuccess(res, 200)).data.diasParaActualizar;
    };
    expect(await dias(hoyMismo.id)).toBe(0);
    expect(await dias(ayer.id)).toBe(-1);
    expect(await dias(manana.id)).toBe(1);

    const idsCon = async (estado: string): Promise<number[]> => {
      const res = await adminApi.get(`${APP_ENDPOINTS.abonos}?estado=${estado}&limit=200`);
      return (await expectSuccess(res, 200)).data.map((a: { id: number }) => a.id);
    };
    // El corte es `<= 0`: el día en que toca actualizarlo ya está pendiente, no «por vencer».
    const vencidos = await idsCon('vencido');
    expect(vencidos).toContain(hoyMismo.id);
    expect(vencidos).toContain(ayer.id);
    expect(vencidos).not.toContain(manana.id);

    const proximos = await idsCon('proximo');
    expect(proximos).toContain(manana.id);
    expect(proximos).not.toContain(hoyMismo.id);   // ← lo que estaba mal

    // El PANEL tiene que decir lo mismo que el listado sobre el mismo abono.
    const panel = (await expectSuccess(await adminApi.get('dashboard'), 200)).data;
    const enPanel = (lista: Array<{ id: number }>) => lista.map(a => a.id);
    expect(enPanel(panel.abonos.vencidos)).toContain(hoyMismo.id);
    expect(enPanel(panel.abonos.proximos)).not.toContain(hoyMismo.id);
  });

  test('M11.9 - resumen: totales en pesos con cotización', async ({ adminApi }) => {
    const res = await adminApi.get(`${APP_ENDPOINTS.abonos}/resumen?clienteId=${clienteId}`);
    const body = await expectSuccess(res, 200);
    expect(body.data).toHaveProperty('activos');
    expect(body.data).toHaveProperty('totalPesos');
    expect(body.data).toHaveProperty('cotizacion');
  });

  test('M11.10 - capability gating: el fixture no ve abonos → 403', async ({ authedApi }) => {
    const res = await authedApi.get(APP_ENDPOINTS.abonos);
    const body = await expectError(res, 403);
    expect(body.message).toContain('abonos:read');
  });

  test('M11.11 - app-config: PUT valida y GET refleja', async ({ adminApi }) => {
    const bad = await adminApi.put(APP_ENDPOINTS.appConfig, { data: { name: 'COTIZACION_DOLAR', value: '-5' } });
    await expectError(bad, 400);

    const ok = await adminApi.put(APP_ENDPOINTS.appConfig, { data: { name: 'COTIZACION_DOLAR', value: '1000' } });
    await expectSuccess(ok, 200);

    const get = await adminApi.get(APP_ENDPOINTS.appConfig);
    const body = await expectSuccess(get, 200);
    const cotiz = body.data.find((c: { name: string }) => c.name === 'COTIZACION_DOLAR');
    expect(cotiz.value).toBe('1000');
  });

  test('M11.12 - dashboard: bloques según capabilities', async ({ adminApi, authedApi }) => {
    const admin = await adminApi.get(APP_ENDPOINTS.dashboard);
    const aBody = await expectSuccess(admin, 200);
    expect(aBody.data).toHaveProperty('cotizacion');
    expect(aBody.data.abonos).toBeTruthy();
    expect(aBody.data.facturacionMes).toBeTruthy();
    // Las estadísticas anuales tienen su propio endpoint (pantalla Estadísticas):
    // el panel no las calcula.
    expect(aBody.data).not.toHaveProperty('estadisticas');

    // El fixture no tiene dashboard:read → 403.
    const fixture = await authedApi.get(APP_ENDPOINTS.dashboard);
    await expectError(fixture, 403);
  });

  test('M11.13 - estadísticas: series anuales con filtro de año', async ({ adminApi, authedApi }) => {
    const res = await adminApi.get(`${APP_ENDPOINTS.estadisticas}?anio=${new Date().getFullYear()}`);
    const body = await expectSuccess(res, 200);
    expect(body.data.anio).toBe(new Date().getFullYear());
    expect(Array.isArray(body.data.anios)).toBe(true);
    // Admin (comodín) ve los tres gráficos: mensual (12 meses), por servicio y por área.
    expect(body.data.mensual.abonos).toHaveLength(12);
    expect(body.data.mensual.proyectos).toHaveLength(12);
    expect(Array.isArray(body.data.servicios)).toBe(true);
    expect(Array.isArray(body.data.areas)).toBe(true);

    // Año fuera de rango → cae al actual (no rompe).
    const raro = await adminApi.get(`${APP_ENDPOINTS.estadisticas}?anio=1800`);
    const rBody = await expectSuccess(raro, 200);
    expect(rBody.data.anio).toBe(new Date().getFullYear());

    // El fixture no tiene estadisticas:read (capability propia de la pantalla) → 403.
    const fixture = await authedApi.get(APP_ENDPOINTS.estadisticas);
    await expectError(fixture, 403);
  });

  test('M11.16 - el listado NO pagina: trae todos los abonos del filtro (facturación masiva)', async ({ adminApi }) => {
    // Varios abonos de prueba para que el conjunto no sea trivial.
    const creados: number[] = [];
    for (let i = 0; i < 3; i++) creados.push((await createAbono(adminApi, { descripcion: `Masivo ${i}` })).id);

    // Nada de comparar totales entre dos pedidos: el proyecto `api` corre en paralelo y otros
    // tests dan de alta y de baja abonos mientras este corre. Cada respuesta se valida contra
    // SÍ MISMA y contra los ids propios, que es lo que realmente prueba que no hay páginas.
    const todos = await expectSuccess(await adminApi.get(APP_ENDPOINTS.abonos), 200);
    for (const id of creados) expect(todos.data.map((a: { id: number }) => a.id)).toContain(id);
    // Una sola página con todo: el frontend no tiene que pedir más nada para seleccionar todo.
    expect(todos.meta.totalPages).toBe(1);
    expect(todos.meta.hasNextPage).toBe(false);
    expect(todos.data).toHaveLength(todos.meta.totalItems);

    // `limit` y `page` se ignoran: con páginas de 5, la 3ra no podría traer TODOS estos ids.
    const recortado = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.abonos}?limit=5&page=3`), 200);
    expect(recortado.data.length).toBeGreaterThan(5);
    expect(recortado.data).toHaveLength(recortado.meta.totalItems);
    for (const id of creados) expect(recortado.data.map((a: { id: number }) => a.id)).toContain(id);

    // Los FILTROS siguen recortando (es lo único que achica el listado).
    const soloUno = await expectSuccess(
      await adminApi.get(`${APP_ENDPOINTS.abonos}?search=${encodeURIComponent('Masivo 1')}`), 200);
    expect(soloUno.data).toHaveLength(soloUno.meta.totalItems);
    expect(soloUno.data.map((a: { id: number }) => a.id)).toContain(creados[1]);
    expect(soloUno.data.map((a: { id: number }) => a.id)).not.toContain(creados[0]);
  });

  test('M11.14 - orden por columna en el servidor: whitelist, dirección y columna inválida', async ({ adminApi }) => {
    // El orden viene del SERVIDOR aunque el listado ya no pagine: es una sola consulta y
    // el frontend pinta lo que llega, sin reordenar por su cuenta.
    const asc = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.abonos}?orden=cliente&dir=asc&limit=20`), 200);
    const desc = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.abonos}?orden=cliente&dir=desc&limit=20`), 200);
    const nombres = (b: { data: Array<{ Cliente?: { nombre: string } }> }) => b.data.map(a => a.Cliente?.nombre ?? '');
    expect(nombres(asc).length).toBeGreaterThan(1);
    // Ascendente de verdad (comparación local, como la del frontend).
    const ordenado = [...nombres(asc)].sort((a, b) => a.localeCompare(b, 'es-AR', { sensitivity: 'base' }));
    expect(nombres(asc)).toEqual(ordenado);
    // Y la dirección opuesta arranca por el otro extremo.
    expect(nombres(desc)[0] >= nombres(asc)[0]).toBe(true);

    // Una columna que no está en la whitelist NO es un error ni se interpola en el SQL:
    // cae al orden por defecto. Así el frontend puede ofrecer columnas que el backend
    // todavía no soporta sin romper el listado.
    const raro = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.abonos}?orden=precio);DROP+TABLE+abonos;--&limit=5`), 200);
    expect(Array.isArray(raro.data)).toBe(true);

    // Facturaciones expone su propio catálogo de columnas.
    const fact = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.facturaciones}?orden=montoPesos&dir=desc&limit=10`), 200);
    const montos = fact.data.rows.map((f: { montoPesos: string }) => Number(f.montoPesos));
    expect(montos).toEqual([...montos].sort((a, b) => b - a));
  });
});
