import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M15 — Empleados: ficha, áreas N:N y el MOTOR DE VACACIONES (casos del análisis 04 §3.3:
 * buckets por año, vencimiento a año+2, consumo del más viejo primero, overrides,
 * Freelance sin vacaciones, solapamiento — mejora).
 */
test.describe('M15: Empleados y vacaciones', () => {
  const cleanup: string[] = [];

  test.afterAll(async () => {
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  async function crearEmpleado(adminApi: import('@playwright/test').APIRequestContext, extra: Record<string, unknown> = {}) {
    const res = await adminApi.post(APP_ENDPOINTS.empleados, {
      data: { ...makeNombre('Empleado'), categoria: 'Relación de dependencia', vacDiasAnuales: 14, ...extra },
    });
    const body = await expectSuccess(res, 201);
    cleanup.push(`empleados/${body.data.id}`);
    return body.data;
  }

  test('M15.1 - alta con áreas → 201; la ficha las devuelve', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi, { areas: [1], email: 'ficha-m15@test.com' });
    const ficha = await adminApi.get(`${APP_ENDPOINTS.empleados}/${emp.id}`);
    const data = (await expectSuccess(ficha, 200)).data;
    expect(data.areas).toHaveLength(1);
    expect(data.vacaciones.aplica).toBe(true);
    expect(data.email).toBe('ficha-m15@test.com');
  });

  test('M15.2 - motor de vacaciones: buckets, vencimiento y consumo del más viejo', async ({ adminApi }) => {
    // Ingreso 2023 con 14/año: 2023 y 2024 VENCIDOS; 2025=14, 2026=14 → disponible 28.
    const emp = await crearEmpleado(adminApi, { fechaIngreso: '2023-03-15' });
    let ficha = (await (await adminApi.get(`${APP_ENDPOINTS.empleados}/${emp.id}`)).json()).data;
    expect(ficha.vacaciones.disponible).toBe(28);
    expect(ficha.vacaciones.dispAnterior).toBe(14);

    // Toma de 7 días corridos INCLUSIVE (12→18 = 7) consume primero el bucket 2025.
    const toma = await adminApi.post(`${APP_ENDPOINTS.empleados}/${emp.id}/vacaciones/tomas`, {
      data: { fechaDesde: '2026-01-12', fechaHasta: '2026-01-18' },
    });
    const tBody = await expectSuccess(toma, 201);
    expect(tBody.data.dias).toBe(7);

    ficha = (await (await adminApi.get(`${APP_ENDPOINTS.empleados}/${emp.id}`)).json()).data;
    expect(ficha.vacaciones.dispAnterior).toBe(7); // 14 − 7 del bucket viejo
    expect(ficha.vacaciones.dispActual).toBe(14);  // el del año no se tocó
    expect(ficha.vacaciones.disponible).toBe(21);
  });

  test('M15.3 - toma sin días suficientes → 400 con el mensaje del legado', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi, { fechaIngreso: '2026-01-01', vacDiasAnuales: 5 });
    // Solo 2026 otorga (5 días); pedir 10 debe fallar.
    const res = await adminApi.post(`${APP_ENDPOINTS.empleados}/${emp.id}/vacaciones/tomas`, {
      data: { fechaDesde: '2026-06-01', fechaHasta: '2026-06-10' },
    });
    const body = await expectError(res, 400);
    expect(body.message).toContain('No alcanzan los días disponibles');
    expect(body.message).toContain('pedís 10');
  });

  test('M15.4 - solapamiento de períodos → 400 (mejora sobre el legado)', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi, { fechaIngreso: '2024-01-01' });
    await adminApi.post(`${APP_ENDPOINTS.empleados}/${emp.id}/vacaciones/tomas`, {
      data: { fechaDesde: '2026-02-02', fechaHasta: '2026-02-06' },
    });
    const solapada = await adminApi.post(`${APP_ENDPOINTS.empleados}/${emp.id}/vacaciones/tomas`, {
      data: { fechaDesde: '2026-02-05', fechaHasta: '2026-02-08' },
    });
    const body = await expectError(solapada, 400);
    expect(body.message).toContain('se solapa');
  });

  test('M15.5 - override por año cambia el otorgamiento; quitarlo lo revierte', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi, { fechaIngreso: '2026-01-01', vacDiasAnuales: 14 });
    const conOverride = await adminApi.put(`${APP_ENDPOINTS.empleados}/${emp.id}/vacaciones/asignacion`, {
      data: { anio: 2026, dias: 21 },
    });
    await expectSuccess(conOverride, 200);
    let ficha = (await (await adminApi.get(`${APP_ENDPOINTS.empleados}/${emp.id}`)).json()).data;
    expect(ficha.vacaciones.dispActual).toBe(21);

    // dias null → quita el ajuste, vuelve al default.
    const sinOverride = await adminApi.put(`${APP_ENDPOINTS.empleados}/${emp.id}/vacaciones/asignacion`, {
      data: { anio: 2026, dias: null },
    });
    expect((await sinOverride.json()).data.quitado).toBe(true);
    ficha = (await (await adminApi.get(`${APP_ENDPOINTS.empleados}/${emp.id}`)).json()).data;
    expect(ficha.vacaciones.dispActual).toBe(14);
  });

  test('M15.6 - Freelance no genera vacaciones (guarda del legado)', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi, { categoria: 'Freelance' });
    const ficha = (await (await adminApi.get(`${APP_ENDPOINTS.empleados}/${emp.id}`)).json()).data;
    expect(ficha.vacaciones.aplica).toBe(false);

    const toma = await adminApi.post(`${APP_ENDPOINTS.empleados}/${emp.id}/vacaciones/tomas`, {
      data: { fechaDesde: '2026-03-02', fechaHasta: '2026-03-06' },
    });
    const body = await expectError(toma, 400);
    expect(body.message).toContain('no genera vacaciones');
  });

  test('M15.7 - empleado con historial de sueldo no se elimina → 409 (mejora)', async ({ adminApi }) => {
    const emp = await crearEmpleado(adminApi);
    await adminApi.put(`${APP_ENDPOINTS.sueldos}/${emp.id}`, { data: { sueldo: 500000 } });
    const del = await adminApi.delete(`${APP_ENDPOINTS.empleados}/${emp.id}`);
    const body = await expectError(del, 409);
    expect(body.message).toContain('registro(s) de sueldo');
  });

  test('M15.8 - capability gating: el fixture no ve empleados → 403', async ({ authedApi }) => {
    const res = await authedApi.get(APP_ENDPOINTS.empleados);
    const body = await expectError(res, 403);
    expect(body.message).toContain('empleados:read');
  });
});
