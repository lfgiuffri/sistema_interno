import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M16 — Sueldos: `salarioEnMes` (casos del análisis 04 §2.0: fin de mes, extensión hacia
 * atrás, desempate), actualización por % con overrides, aumentos programados (base única,
 * pisado AVISADO), planificación (fechaPago conservada, monto 0 borra) y cuentas protegidas.
 */
test.describe('M16: Sueldos', () => {
  const cleanup: string[] = [];

  test.afterAll(async () => {
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  async function crearEmpleado(adminApi: import('@playwright/test').APIRequestContext, extra: Record<string, unknown> = {}) {
    const res = await adminApi.post(APP_ENDPOINTS.empleados, {
      data: { ...makeNombre('Sueldos'), categoria: 'Relación de dependencia', ...extra },
    });
    const body = await expectSuccess(res, 201);
    cleanup.push(`empleados/${body.data.id}`);
    return body.data;
  }

  test('M16.1 - carga inicial + tipo de historial + vigente en el listado', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi);
    const set = await adminApi.put(`${APP_ENDPOINTS.sueldos}/${emp.id}`, { data: { sueldo: 900000 } });
    await expectSuccess(set, 200);

    const hist = (await (await adminApi.get(`${APP_ENDPOINTS.sueldos}/${emp.id}/historial`)).json()).data;
    expect(hist.historial[0].tipo).toBe('Carga inicial');
    expect(hist.vigente).toBe(900000);

    const list = (await (await adminApi.get(APP_ENDPOINTS.sueldos)).json()).data;
    const fila = list.rows.find((r: { id: number }) => r.id === emp.id);
    expect(fila.vigente).toBe(900000);
  });

  test('M16.2 - guardar el mismo monto NO genera histórico espurio (bug del legado corregido)', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi);
    await adminApi.put(`${APP_ENDPOINTS.sueldos}/${emp.id}`, { data: { sueldo: 750000 } });
    const repe = await adminApi.put(`${APP_ENDPOINTS.sueldos}/${emp.id}`, { data: { sueldo: 750000 } });
    expect((await repe.json()).data.registrado).toBe(false);

    const hist = (await (await adminApi.get(`${APP_ENDPOINTS.sueldos}/${emp.id}/historial`)).json()).data;
    expect(hist.historial).toHaveLength(1);
  });

  test('M16.3 - actualización por % masiva con override por fila (base = vigente)', async ({ adminApi }) => {
    const emp1 = await crearEmpleado(adminApi);
    const emp2 = await crearEmpleado(adminApi);
    await adminApi.put(`${APP_ENDPOINTS.sueldos}/${emp1.id}`, { data: { sueldo: 1000000 } });
    await adminApi.put(`${APP_ENDPOINTS.sueldos}/${emp2.id}`, { data: { sueldo: 2000000 } });

    const preview = await adminApi.post(`${APP_ENDPOINTS.sueldos}/actualizar/preview`, {
      data: { ids: [emp1.id, emp2.id], porcentaje: '10', overrides: { [emp2.id]: '-5' } },
    });
    const filas = (await expectSuccess(preview, 200)).data;
    expect(filas.find((f: { empleadoId: number }) => f.empleadoId === emp1.id).nuevo).toBe(1100000);
    expect(filas.find((f: { empleadoId: number }) => f.empleadoId === emp2.id).nuevo).toBe(1900000); // −5%

    await expectSuccess(await adminApi.post(`${APP_ENDPOINTS.sueldos}/actualizar`, {
      data: { ids: [emp1.id, emp2.id], porcentaje: '10', overrides: { [emp2.id]: '-5' } },
    }), 200);

    const list = (await (await adminApi.get(APP_ENDPOINTS.sueldos)).json()).data;
    expect(list.rows.find((r: { id: number }) => r.id === emp2.id).vigente).toBe(1900000);
  });

  test('M16.4 - aumentos programados: base única (no se encadenan) + pisado avisado en preview', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi);
    await adminApi.put(`${APP_ENDPOINTS.sueldos}/${emp.id}`, { data: { sueldo: 1000000 } });

    const hoy = new Date();
    const anio = hoy.getFullYear();
    const lineas = [
      { anio: anio + 1, mes: 1, tipo: 'pct', valor: '10' },
      { anio: anio + 1, mes: 3, tipo: 'pct', valor: '20' },
    ];
    const preview = await adminApi.post(`${APP_ENDPOINTS.sueldos}/aumentos/preview`, {
      data: { ids: [emp.id], baseAnio: anio, baseMes: hoy.getMonth() + 1, lineas },
    });
    const data = (await expectSuccess(preview, 200)).data;
    // NO encadenados: ambos sobre la misma base 1.000.000.
    expect(data.filas[0].valores[0].nuevo).toBe(1100000);
    expect(data.filas[0].valores[1].nuevo).toBe(1200000);
    expect(data.pisados).toHaveLength(0);

    await expectSuccess(await adminApi.post(`${APP_ENDPOINTS.sueldos}/aumentos`, {
      data: { ids: [emp.id], baseAnio: anio, baseMes: hoy.getMonth() + 1, lineas },
    }), 200);

    // El historial encadena los sueldoAnterior DENTRO de la tanda (enero→marzo).
    const hist = (await (await adminApi.get(`${APP_ENDPOINTS.sueldos}/${emp.id}/historial`)).json()).data;
    const marzo = hist.historial.find((h: { fecha: string }) => h.fecha === `${anio + 1}-03-01`);
    expect(marzo.anterior).toBe(1100000); // ve el INSERT de enero de la misma tanda
    expect(marzo.nuevo).toBe(1200000);

    // Reprogramar enero PISA: el preview lo avisa (mejora sobre el DELETE silencioso).
    const rePreview = await adminApi.post(`${APP_ENDPOINTS.sueldos}/aumentos/preview`, {
      data: { ids: [emp.id], baseAnio: anio, baseMes: hoy.getMonth() + 1, lineas: [{ anio: anio + 1, mes: 1, tipo: 'fijo', valor: '1500000' }] },
    });
    const reData = (await rePreview.json()).data;
    expect(reData.pisados).toHaveLength(1);
    expect(reData.pisados[0].fecha).toBe(`${anio + 1}-01-01`);

    // El vigente HOY no cambió (las líneas son futuras).
    const list = (await (await adminApi.get(APP_ENDPOINTS.sueldos)).json()).data;
    const fila = list.rows.find((r: { id: number }) => r.id === emp.id);
    expect(fila.vigente).toBe(1000000);
    expect(fila.futuros).toBe(2);
  });

  test('M16.5 - planificación: fechaPago se conserva al re-guardar; monto 0 borra la celda', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi);
    await adminApi.put(`${APP_ENDPOINTS.sueldos}/${emp.id}`, { data: { sueldo: 800000 } });
    const cuentas = (await (await adminApi.get(`${APP_ENDPOINTS.sueldos}/cuentas`)).json()).data;
    const cta = cuentas[0].id;
    // Período propio del test para no chocar con otros (mes 2 de un año pasado fijo).
    const anio = 2024, mes = 2;

    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.sueldos}/planificacion`, {
      data: { anio, mes, celdas: [{ empleadoId: emp.id, cuentaId: cta, monto: 800000, pagado: true }], disponibles: [{ cuentaId: cta, monto: 1000000 }] },
    }), 200);

    let plan = (await (await adminApi.get(`${APP_ENDPOINTS.sueldos}/planificacion?anio=${anio}&mes=${mes}`)).json()).data;
    const celda = plan.celdas.find((c: { empleadoId: number }) => c.empleadoId === emp.id);
    const fechaPago = celda.fechaPago;
    expect(fechaPago).toBeTruthy();

    // Re-guardar con otro monto, sigue pagado → fechaPago intacta.
    await adminApi.put(`${APP_ENDPOINTS.sueldos}/planificacion`, {
      data: { anio, mes, celdas: [{ empleadoId: emp.id, cuentaId: cta, monto: 850000, pagado: true }], disponibles: [] },
    });
    plan = (await (await adminApi.get(`${APP_ENDPOINTS.sueldos}/planificacion?anio=${anio}&mes=${mes}`)).json()).data;
    expect(plan.celdas.find((c: { empleadoId: number }) => c.empleadoId === emp.id).fechaPago).toBe(fechaPago);

    // Monto 0 → la celda desaparece.
    await adminApi.put(`${APP_ENDPOINTS.sueldos}/planificacion`, {
      data: { anio, mes, celdas: [{ empleadoId: emp.id, cuentaId: cta, monto: 0, pagado: false }], disponibles: [] },
    });
    plan = (await (await adminApi.get(`${APP_ENDPOINTS.sueldos}/planificacion?anio=${anio}&mes=${mes}`)).json()).data;
    expect(plan.celdas.find((c: { empleadoId: number }) => c.empleadoId === emp.id)).toBeUndefined();
  });

  test('M16.6 - cuentas: duplicada → 400; con pagos no se elimina → 409 (mejora)', async ({ adminApi }) => {
    const nombre = makeNombre('Cuenta').nombre;
    const alta = await adminApi.post(`${APP_ENDPOINTS.sueldos}/cuentas`, { data: { nombre } });
    const cuenta = (await expectSuccess(alta, 201)).data;
    cleanup.push(`cuentas/${cuenta.id}`);

    await expectError(await adminApi.post(`${APP_ENDPOINTS.sueldos}/cuentas`, { data: { nombre } }), 400);

    const emp = await crearEmpleado(adminApi);
    await adminApi.put(`${APP_ENDPOINTS.sueldos}/planificacion`, {
      data: { anio: 2024, mes: 3, celdas: [{ empleadoId: emp.id, cuentaId: cuenta.id, monto: 100, pagado: false }], disponibles: [] },
    });
    const del = await adminApi.delete(`${APP_ENDPOINTS.sueldos}/cuentas/${cuenta.id}`);
    const body = await expectError(del, 409);
    expect(body.message).toContain('pago(s)');
  });

  test('M16.7 - sueldo de inactivo no se actualiza → 400 (bug del legado corregido)', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi);
    await adminApi.patch(`${APP_ENDPOINTS.empleados}/${emp.id}/active`);
    const res = await adminApi.put(`${APP_ENDPOINTS.sueldos}/${emp.id}`, { data: { sueldo: 100 } });
    const body = await expectError(res, 400);
    expect(body.message).toContain('activos');
  });

  test('M16.8 - capability gating: el fixture no ve sueldos → 403', async ({ authedApi }) => {
    const res = await authedApi.get(APP_ENDPOINTS.sueldos);
    const body = await expectError(res, 403);
    expect(body.message).toContain('sueldos:read');
  });
});
