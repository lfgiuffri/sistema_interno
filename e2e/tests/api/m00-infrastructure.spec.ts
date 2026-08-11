import { test, expect } from '../../fixtures/auth.fixture';
import { INFRA_ENDPOINTS } from '../../helpers/constants';

/**
 * M0 — Infraestructura de la API.
 * Verifica el root del router, el spec OpenAPI y la UI de docs (Scalar).
 */
test.describe('M0: Infraestructura', () => {
  test('M0.1 - GET /api/ responde el mensaje de salud (200, sin auth)', async ({ unauthApi }) => {
    // baseURL termina en `/api/`; get('') golpea exactamente `/api/`.
    const res = await unauthApi.get(INFRA_ENDPOINTS.root);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('message');
  });

  test('M0.2 - GET /api/openapi.json → 200 con spec OpenAPI 3', async ({ unauthApi }) => {
    const res = await unauthApi.get(INFRA_ENDPOINTS.openapi);
    expect(res.status()).toBe(200);
    const spec = await res.json();
    expect(spec).toHaveProperty('openapi');
    expect(String(spec.openapi)).toMatch(/^3\./);
    expect(spec).toHaveProperty('paths');
    expect(typeof spec.paths).toBe('object');
  });

  test('M0.3 - GET /api/docs → 200 (Scalar API reference)', async ({ unauthApi }) => {
    const res = await unauthApi.get(INFRA_ENDPOINTS.docs);
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'] || '';
    expect(contentType).toContain('text/html');
  });
});
