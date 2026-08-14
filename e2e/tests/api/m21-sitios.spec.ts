import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M21 — Mantenimiento (Sitios web): ABM, validación de URL, chequeo manual con sus tres
 * estados, y la regla de que una fecha de dominio cargada a mano deja de refrescarse sola.
 *
 * Los tests que salen a internet (chequeo y RDAP) usan sitios propios y toleran que la red
 * falle: lo que se verifica es el CONTRATO (forma de la respuesta y efecto en el registro),
 * no que el sitio de turno esté arriba.
 */
test.describe.configure({ mode: 'serial' });

test.describe('M21: Mantenimiento — Sitios web', () => {
  const cleanup: string[] = [];
  let sitioId = 0;

  /** URL única por corrida: el alta valida que no se repita. */
  const urlUnica = () => `https://e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}.positivemedia.com.ar`;

  test.afterAll(async () => {
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  test('M21.1 - alta: nace sin chequear y deriva el dominio de la URL', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.sitios, {
      data: { ...makeNombre('Sitio'), url: 'https://www.positivemedia.com.ar/inicio' },
    });
    const body = await expectSuccess(res, 201);
    sitioId = body.data.id;
    cleanup.push(`sitios/${sitioId}`);

    expect(body.data.estado).toBe('desconocido');
    expect(body.data.dominio).toBe('positivemedia.com.ar');   // sin www ni path
    expect(body.data.verificaMarcador).toBe(true);
    expect(body.data.dominioAuto).toBe(false);                // todavía no se consultó
  });

  test('M21.2 - URL inválida → 400; URL repetida → 400', async ({ adminApi }) => {
    await expectError(await adminApi.post(APP_ENDPOINTS.sitios, {
      data: { ...makeNombre('Sitio'), url: 'no-es-una-url' },
    }), 400);

    const url = urlUnica();
    const primero = await adminApi.post(APP_ENDPOINTS.sitios, { data: { ...makeNombre('Sitio'), url } });
    cleanup.push(`sitios/${(await primero.json()).data.id}`);

    await expectError(await adminApi.post(APP_ENDPOINTS.sitios, {
      data: { ...makeNombre('Sitio'), url },
    }), 400);
  });

  test('M21.3 - nombre vacío → 422', async ({ adminApi }) => {
    await expectError(await adminApi.post(APP_ENDPOINTS.sitios, {
      data: { nombre: '', url: urlUnica() },
    }), 422);
  });

  test('M21.4 - chequeo manual: guarda el resultado y deja el estado en el sitio', async ({ adminApi }) => {
    const res = await adminApi.post(`${APP_ENDPOINTS.sitios}/${sitioId}/chequear`);
    const chequeo = (await expectSuccess(res, 200)).data;

    // Los tres estados posibles del contrato: online / sin_marcador / offline.
    expect(['online', 'sin_marcador', 'offline']).toContain(chequeo.estado);
    expect(typeof chequeo.tiempoMs).toBe('number');

    const ficha = (await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.sitios}/${sitioId}`), 200)).data;
    expect(ficha.estado).toBe(chequeo.estado);
    expect(ficha.ultimoChequeoAt).toBeTruthy();
    expect(ficha.chequeos.length).toBeGreaterThan(0);
    expect(typeof ficha.disponibilidad).toBe('number');
  });

  test('M21.5 - un sitio que no existe queda offline (no rompe el chequeo)', async ({ adminApi }) => {
    const alta = await adminApi.post(APP_ENDPOINTS.sitios, {
      data: { ...makeNombre('Sitio caído'), url: `https://no-existe-${Date.now()}.positivemedia.com.ar` },
    });
    const id = (await expectSuccess(alta, 201)).data.id;
    cleanup.push(`sitios/${id}`);

    const chequeo = (await expectSuccess(await adminApi.post(`${APP_ENDPOINTS.sitios}/${id}/chequear`), 200)).data;
    expect(chequeo.estado).toBe('offline');
    expect(chequeo.motivo).toBeTruthy();
  });

  test('M21.6 - cargar la fecha de dominio a mano desactiva el refresco automático', async ({ adminApi }) => {
    const res = await adminApi.put(`${APP_ENDPOINTS.sitios}/${sitioId}`, {
      data: { nombre: 'Sitio con fecha manual', url: 'https://www.positivemedia.com.ar/inicio', dominioVenceAt: '2030-01-15' },
    });
    const body = (await expectSuccess(res, 200)).data;
    expect(body.dominioVenceAt).toBe('2030-01-15');
    expect(body.dominioAuto).toBe(false);

    // El estado del vencimiento se DERIVA de la fecha, no se guarda.
    const ficha = (await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.sitios}/${sitioId}`), 200)).data;
    expect(ficha.dominioEstado.estado).toBe('ok');
    expect(ficha.dominioEstado.dias).toBeGreaterThan(0);
  });

  test('M21.7 - cambiar el dominio de la URL limpia la fecha y vuelve a lo automático', async ({ adminApi }) => {
    const res = await adminApi.put(`${APP_ENDPOINTS.sitios}/${sitioId}`, {
      data: { nombre: 'Sitio mudado', url: urlUnica() },
    });
    const body = (await expectSuccess(res, 200)).data;
    expect(body.dominioVenceAt).toBeNull();
    expect(body.dominioAuto).toBe(true);   // dominio nuevo, sin fecha manual: que la busque RDAP
  });

  test('M21.7b - borrar la fecha manual reactiva el refresco automático', async ({ adminApi }) => {
    const url = urlUnica();
    const alta = await adminApi.post(APP_ENDPOINTS.sitios, { data: { ...makeNombre('Sitio'), url } });
    const id = (await expectSuccess(alta, 201)).data.id;
    cleanup.push(`sitios/${id}`);

    const manual = (await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.sitios}/${id}`, {
      data: { nombre: 'Con fecha', url, dominioVenceAt: '2031-03-10' },
    }), 200)).data;
    expect(manual.dominioAuto).toBe(false);

    // El formulario manda cadena vacía para "sin fecha".
    const borrada = (await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.sitios}/${id}`, {
      data: { nombre: 'Sin fecha', url, dominioVenceAt: '' },
    }), 200)).data;
    expect(borrada.dominioVenceAt).toBeNull();
    expect(borrada.dominioAuto).toBe(true);
  });

  test('M21.8 - toggle y baja lógica', async ({ adminApi }) => {
    const off = (await expectSuccess(await adminApi.patch(`${APP_ENDPOINTS.sitios}/${sitioId}/active`), 200)).data;
    expect(off.activo).toBe(false);

    await expectSuccess(await adminApi.delete(`${APP_ENDPOINTS.sitios}/${sitioId}`), 200);
    await expectError(await adminApi.get(`${APP_ENDPOINTS.sitios}/${sitioId}`), 404);
  });

  test('M21.9 - sin auth → 401; el fixture (sin sitios:read) → 403; inexistente → 404', async ({ unauthApi, authedApi, adminApi }) => {
    await expectError(await unauthApi.get(APP_ENDPOINTS.sitios), 401);
    await expectError(await authedApi.get(APP_ENDPOINTS.sitios), 403);
    await expectError(await adminApi.get(`${APP_ENDPOINTS.sitios}/99999999`), 404);
  });

  test('M21.11 - el panel trae el resumen agregado de infraestructura, sin el detalle', async ({ adminApi }) => {
    const url = urlUnica();
    const alta = await adminApi.post(APP_ENDPOINTS.sitios, { data: { ...makeNombre('Sitio'), url } });
    cleanup.push(`sitios/${(await expectSuccess(alta, 201)).data.id}`);

    const panel = (await expectSuccess(await adminApi.get(APP_ENDPOINTS.dashboard), 200)).data;
    expect(panel.mantenimiento).toBeTruthy();

    const { servidores, sitios } = panel.mantenimiento;
    for (const bloque of [servidores, sitios]) {
      expect(bloque).toBeTruthy();
      // Resumen, no detalle: solo conteos — ni un array de entidades.
      for (const v of Object.values(bloque as Record<string, unknown>)) {
        expect(Array.isArray(v)).toBe(false);
      }
    }
    expect(sitios.total).toBeGreaterThan(0);
    // Los estados particionan el total (nadie se cuenta dos veces ni queda afuera).
    expect(sitios.online + sitios.sinMarcador + sitios.offline + sitios.sinChequear).toBe(sitios.total);
    expect(servidores.online + servidores.offline + servidores.sinDatos).toBe(servidores.total);
  });

  test('M21.10 - /health es público y no pide sesión (lo usa el watchdog externo)', async ({ unauthApi }) => {
    const res = await unauthApi.get('health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.uptimeSeg).toBe('number');
  });
});
