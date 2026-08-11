import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError, expectPagination } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M10 — Catálogos de la Fase 1: áreas, clientes, servicios y formas de facturación.
 *
 * Comportamiento compartido de los ABMs (unicidad + reactivación de eliminados, toggle,
 * capability gating) + reglas específicas: FK servicio→área y protecciones de borrado.
 */
test.describe('M10: Catálogos (áreas/clientes/servicios/formas)', () => {
  const cleanup: string[] = [];

  test.afterAll(async () => {
    // Se borra en orden inverso (los servicios antes que sus áreas).
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  /** Alta de un recurso y registro para cleanup. Devuelve el registro creado. */
  async function create(adminApi: import('@playwright/test').APIRequestContext, endpoint: string, data: Record<string, unknown>) {
    const res = await adminApi.post(endpoint, { data });
    const body = await expectSuccess(res, 201);
    cleanup.push(`${endpoint}/${body.data.id}`);
    return body.data;
  }

  test('M10.1 - GET /areas → 200 con seeds y meta de paginación', async ({ adminApi }) => {
    const res = await adminApi.get(`${APP_ENDPOINTS.areas}?page=1&limit=10`);
    const body = await expectSuccess(res, 200);
    expect(Array.isArray(body.data)).toBeTruthy();
    expectPagination(body.meta);
    // Cada área trae el conteo de servicios (para la protección visible en la UI).
    if (body.data.length) expect(body.data[0]).toHaveProperty('serviciosCount');
  });

  test('M10.2 - crear en los 4 catálogos → 201', async ({ adminApi }) => {
    await create(adminApi, APP_ENDPOINTS.areas, makeNombre('Área'));
    await create(adminApi, APP_ENDPOINTS.clientes, makeNombre('Cliente'));
    await create(adminApi, APP_ENDPOINTS.servicios, makeNombre('Servicio'));
    await create(adminApi, APP_ENDPOINTS.formasFacturacion, makeNombre('Forma'));
  });

  test('M10.3 - nombre duplicado → 400 en todos', async ({ adminApi }) => {
    for (const endpoint of [APP_ENDPOINTS.areas, APP_ENDPOINTS.clientes, APP_ENDPOINTS.servicios, APP_ENDPOINTS.formasFacturacion]) {
      const data = makeNombre('Dup');
      await create(adminApi, endpoint, data);
      const dup = await adminApi.post(endpoint, { data });
      const body = await expectError(dup, 400);
      expect(body.message).toContain('Ya existe');
    }
  });

  test('M10.4 - recrear un eliminado → 409 EXISTE_ELIMINADO + restore lo reactiva', async ({ adminApi }) => {
    const data = makeNombre('Cliente Reactivable');
    const created = await create(adminApi, APP_ENDPOINTS.clientes, data);

    const del = await adminApi.delete(`${APP_ENDPOINTS.clientes}/${created.id}`);
    await expectSuccess(del, 200);

    const recreate = await adminApi.post(APP_ENDPOINTS.clientes, { data });
    const body = await expectError(recreate, 409);
    expect(body.errorCode).toBe('EXISTE_ELIMINADO');
    expect(body.deletedId).toBe(created.id);

    const restore = await adminApi.patch(`${APP_ENDPOINTS.clientes}/${created.id}/restore`);
    const restored = await expectSuccess(restore, 200);
    expect(restored.data).toHaveProperty('nombre', data.nombre);
  });

  test('M10.5 - PATCH /:id/active alterna el estado', async ({ adminApi }) => {
    const area = await create(adminApi, APP_ENDPOINTS.areas, makeNombre('Área Toggle'));
    const off = await adminApi.patch(`${APP_ENDPOINTS.areas}/${area.id}/active`);
    expect((await off.json()).data.activo).toBe(false);
    const on = await adminApi.patch(`${APP_ENDPOINTS.areas}/${area.id}/active`);
    expect((await on.json()).data.activo).toBe(true);
  });

  test('M10.6 - servicio con área: la FK se valida y la respuesta incluye el área', async ({ adminApi }) => {
    const area = await create(adminApi, APP_ENDPOINTS.areas, makeNombre('Área FK'));
    const servicio = await create(adminApi, APP_ENDPOINTS.servicios, makeNombre('Servicio FK', { areaId: area.id }));
    expect(servicio.area).toBeTruthy();
    expect(servicio.area.id).toBe(area.id);

    const bad = await adminApi.post(APP_ENDPOINTS.servicios, { data: makeNombre('Servicio FK mala', { areaId: 99999999 }) });
    const body = await expectError(bad, 400);
    expect(body.message).toContain('área');
  });

  test('M10.7 - protección: área con servicios no se elimina → 409', async ({ adminApi }) => {
    const area = await create(adminApi, APP_ENDPOINTS.areas, makeNombre('Área Protegida'));
    await create(adminApi, APP_ENDPOINTS.servicios, makeNombre('Servicio Protector', { areaId: area.id }));

    const del = await adminApi.delete(`${APP_ENDPOINTS.areas}/${area.id}`);
    const body = await expectError(del, 409);
    expect(body.message).toContain('servicio');
  });

  test('M10.8 - capability gating: el fixture (solo areas) no ve los otros catálogos → 403', async ({ authedApi }) => {
    // El fixture ahora tiene areas:* (reemplazó al módulo de ejemplo items, eliminado
    // en la fase final) — el deny-by-default se verifica con el resto.
    for (const [endpoint, cap] of [
      [APP_ENDPOINTS.clientes, 'clientes:read'],
      [APP_ENDPOINTS.servicios, 'servicios:read'],
      [APP_ENDPOINTS.formasFacturacion, 'formas-facturacion:read'],
    ] as const) {
      const res = await authedApi.get(endpoint);
      const body = await expectError(res, 403);
      expect(body.message).toContain(cap);
    }
  });

  test('M10.9 - validación: nombre vacío → 422', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.clientes, { data: { nombre: '' } });
    await expectError(res, 422);
  });

  test('M10.10 - búsqueda y filtro activo en clientes', async ({ adminApi }) => {
    const c = await create(adminApi, APP_ENDPOINTS.clientes, makeNombre('Cliente Buscable'));
    await adminApi.patch(`${APP_ENDPOINTS.clientes}/${c.id}/active`); // → inactivo

    const found = await adminApi.get(`${APP_ENDPOINTS.clientes}?search=Buscable&activo=false`);
    const body = await expectSuccess(found, 200);
    expect(body.data.some((x: { id: number }) => x.id === c.id)).toBeTruthy();

    const notFound = await adminApi.get(`${APP_ENDPOINTS.clientes}?search=Buscable&activo=true`);
    const body2 = await expectSuccess(notFound, 200);
    expect(body2.data.some((x: { id: number }) => x.id === c.id)).toBeFalsy();
  });
});
