import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M12 — Proyectos + cobranzas: tope de presupuesto, cobro con cotización derivada,
 * protecciones sobre cuotas cobradas y auditoría de eventos.
 */
test.describe('M12: Proyectos y cobranzas', () => {
  const cleanup: string[] = [];
  let clienteId = 0;

  test.beforeAll(async ({ adminApi }) => {
    const cliente = await adminApi.post(APP_ENDPOINTS.clientes, { data: makeNombre('Cliente Proyectos') });
    clienteId = (await cliente.json()).data.id;
    cleanup.push(`clientes/${clienteId}`);
  });

  test.afterAll(async () => {
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  /** Crea un proyecto USD de prueba con presupuesto. */
  async function createProyecto(adminApi: import('@playwright/test').APIRequestContext, extra: Record<string, unknown> = {}) {
    const res = await adminApi.post(APP_ENDPOINTS.proyectos, {
      data: {
        clienteId, nombre: `Proyecto E2E ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        estado: 'en_desarrollo', moneda: 'USD', total: 5000, ...extra,
      },
    });
    const body = await expectSuccess(res, 201);
    cleanup.push(`proyectos/${body.data.id}`);
    return body.data;
  }

  test('M12.1 - crear proyecto → 201 con cliente y días de entrega calculados', async ({ adminApi }) => {
    const p = await createProyecto(adminApi, { fechaEstimadaEntrega: '2030-01-01' });
    expect(p.cliente).toBeTruthy();
    expect(p).toHaveProperty('diasParaEntrega');
  });

  test('M12.2 - estado inválido → 422', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.proyectos, {
      data: { clienteId, nombre: 'X', estado: 'inventado', moneda: 'USD', total: 0 },
    });
    await expectError(res, 422);
  });

  test('M12.3 - tope de presupuesto: una cuota que lo supera → 400 con el disponible', async ({ adminApi }) => {
    const p = await createProyecto(adminApi); // USD 5000
    const ok = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas`, {
      data: { anio: 2030, mes: 1, montoUsd: 3000 },
    });
    await expectSuccess(ok, 201);

    const excede = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas`, {
      data: { anio: 2030, mes: 2, montoUsd: 2500 },
    });
    const body = await expectError(excede, 400);
    expect(body.message).toContain('presupuesto');
    expect(body.message).toContain('2000');
  });

  test('M12.4 - cobrar: peso real → cotización derivada + congelado + auditoría', async ({ adminApi }) => {
    const p = await createProyecto(adminApi);
    const cuotaRes = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas`, {
      data: { anio: 2030, mes: 3, montoUsd: 1000 },
    });
    const cuotaId = (await cuotaRes.json()).data.id;

    const cobro = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas/${cuotaId}/cobrar`, {
      data: { montoPesos: 1250000 },
    });
    const body = await expectSuccess(cobro, 200);
    expect(Number(body.data.montoPesos)).toBe(1250000);
    expect(Number(body.data.cotizacion)).toBe(1250); // derivada: 1250000 / 1000
    expect(body.data.fechaCobro).toBeTruthy();

    const detalle = await adminApi.get(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas`);
    const data = (await detalle.json()).data;
    expect(data.eventos.some((e: { tipo: string }) => e.tipo === 'cobrada')).toBeTruthy();
    expect(Number(data.kpis.cobradoPesos)).toBe(1250000);
  });

  test('M12.5 - una cuota COBRADA no se mueve, no se edita y no se elimina', async ({ adminApi }) => {
    const p = await createProyecto(adminApi);
    const cuotaRes = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas`, {
      data: { anio: 2030, mes: 4, montoUsd: 500 },
    });
    const cuotaId = (await cuotaRes.json()).data.id;
    await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas/${cuotaId}/cobrar`, { data: { montoPesos: 600000 } });

    const mover = await adminApi.patch(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas/mover`, {
      data: { cobranzaIds: [cuotaId], anio: 2030, mes: 6 },
    });
    await expectError(mover, 400);

    const editar = await adminApi.patch(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas/${cuotaId}/monto`, {
      data: { montoUsd: 700 },
    });
    await expectError(editar, 400);

    const eliminar = await adminApi.delete(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas/${cuotaId}`);
    await expectError(eliminar, 400);
  });

  test('M12.6 - descobrar es accesible y deja el rastro del cobro en la auditoría', async ({ adminApi }) => {
    const p = await createProyecto(adminApi);
    const cuotaRes = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas`, {
      data: { anio: 2030, mes: 5, montoUsd: 800 },
    });
    const cuotaId = (await cuotaRes.json()).data.id;
    await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas/${cuotaId}/cobrar`, { data: { montoPesos: 900000 } });

    const descobrar = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas/${cuotaId}/descobrar`);
    const body = await expectSuccess(descobrar, 200);
    expect(body.data.cobrado).toBe(false);
    expect(body.data.montoPesos).toBeNull();

    const detalle = await adminApi.get(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas`);
    const eventos = (await detalle.json()).data.eventos;
    const descobro = eventos.find((e: { tipo: string; detalle: string }) => e.tipo === 'descobrada');
    expect(descobro).toBeTruthy();
    expect(descobro.detalle).toContain('900000'); // el rastro del cobro sobrevive
  });

  test('M12.7 - cobranzas scoped: una cuota de OTRO proyecto → 404', async ({ adminApi }) => {
    const p1 = await createProyecto(adminApi);
    const p2 = await createProyecto(adminApi);
    const cuotaRes = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p1.id}/cobranzas`, {
      data: { anio: 2030, mes: 7, montoUsd: 100 },
    });
    const cuotaId = (await cuotaRes.json()).data.id;

    // Intentar cobrarla "desde" p2 → 404 (el legado no scopeaba, bug #5).
    const res = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p2.id}/cobranzas/${cuotaId}/cobrar`, {
      data: { montoPesos: 100000 },
    });
    await expectError(res, 404);
  });

  test('M12.8 - un proyecto con cobranzas cobradas no se elimina → 409', async ({ adminApi }) => {
    const p = await createProyecto(adminApi);
    const cuotaRes = await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas`, {
      data: { anio: 2030, mes: 8, montoUsd: 300 },
    });
    const cuotaId = (await cuotaRes.json()).data.id;
    await adminApi.post(`${APP_ENDPOINTS.proyectos}/${p.id}/cobranzas/${cuotaId}/cobrar`, { data: { montoPesos: 350000 } });

    const del = await adminApi.delete(`${APP_ENDPOINTS.proyectos}/${p.id}`);
    const body = await expectError(del, 409);
    expect(body.message).toContain('cobrada');
  });

  test('M12.9 - grilla anual: celdas con pesos/USD/ids', async ({ adminApi }) => {
    const res = await adminApi.get(`${APP_ENDPOINTS.proyectos}/grilla?anio=2030`);
    const body = await expectSuccess(res, 200);
    expect(body.data).toHaveProperty('filas');
    expect(body.data).toHaveProperty('totalesMes');
    expect(Array.isArray(body.data.anios)).toBeTruthy();
  });

  test('M12.10 - capability gating: el fixture no ve proyectos → 403', async ({ authedApi }) => {
    const res = await authedApi.get(APP_ENDPOINTS.proyectos);
    const body = await expectError(res, 403);
    expect(body.message).toContain('proyectos:read');
  });
});
