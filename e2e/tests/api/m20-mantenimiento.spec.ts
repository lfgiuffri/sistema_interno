import { test, expect } from '../../fixtures/auth.fixture';
import { API_BASE, APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M20 — Mantenimiento (Servidores): ABM, token del agente, ingesta de métricas con su
 * propia autenticación (sin sesión), umbrales que abren y cierran incidentes, y el
 * anti-spam que evita repetir la misma alerta.
 */
// Serial a propósito: son los pasos de UNA historia (se da de alta el servidor, su agente
// reporta, se dispara y se resuelve un incidente, se rota el token). El proyecto `api` corre
// en paralelo por defecto y el token que produce el primer test lo usan los siguientes.
test.describe.configure({ mode: 'serial' });

test.describe('M20: Mantenimiento — Servidores', () => {
  const cleanup: string[] = [];
  let servidorId = 0;
  let token = '';

  /** IP única por corrida: el alta valida que no se repita. */
  const ipUnica = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  test.afterAll(async () => {
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  test('M20.1 - alta: devuelve el token del agente UNA sola vez', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.servidores, {
      data: { ...makeNombre('VPS'), ip: ipUnica(), monitorea: true },
    });
    const body = await expectSuccess(res, 201);
    servidorId = body.data.id;
    token = body.data.token;
    cleanup.push(`servidores/${servidorId}`);

    expect(token).toHaveLength(64);          // 32 bytes en hexadecimal
    expect(body.data.estado).toBe('desconocido');

    // Al releerlo, el token ya no viaja: solo si tiene uno configurado.
    const ficha = await adminApi.get(`${APP_ENDPOINTS.servidores}/${servidorId}`);
    const detalle = (await expectSuccess(ficha, 200)).data;
    expect(detalle.token).toBeUndefined();
    expect(detalle.tieneToken).toBe(true);
  });

  test('M20.2 - IP duplicada → 400', async ({ adminApi }) => {
    const ip = ipUnica();
    const primero = await adminApi.post(APP_ENDPOINTS.servidores, { data: { ...makeNombre('VPS'), ip } });
    cleanup.push(`servidores/${(await primero.json()).data.id}`);

    const dup = await adminApi.post(APP_ENDPOINTS.servidores, { data: { ...makeNombre('VPS'), ip } });
    const body = await expectError(dup, 400);
    expect(body.message).toContain(ip);
  });

  test('M20.3 - ingesta: el agente reporta con su token y el servidor queda online', async ({ playwright }) => {
    // Contexto SIN sesión: el agente se autentica solo con su token.
    const agente = await playwright.request.newContext({ baseURL: `${API_BASE}/` });

    const res = await agente.post('agente/metricas', {
      headers: { 'x-agent-token': token },
      data: { cpu: 12.5, ram: 40, disco: 30, discos: [{ montaje: '/', uso: 30, libreGb: 12.5 }], so: 'Ubuntu 24.04' },
    });
    const body = await expectSuccess(res, 200);
    expect(body.data.alertas).toEqual([]);   // nada supera los umbrales
    await agente.dispose();
  });

  test('M20.4 - ingesta: sin token → 401, token inválido → 401, payload inválido → 422', async ({ playwright }) => {
    const agente = await playwright.request.newContext({ baseURL: `${API_BASE}/` });
    const metrica = { cpu: 1, ram: 1, disco: 1 };

    await expectError(await agente.post('agente/metricas', { data: metrica }), 401);
    await expectError(await agente.post('agente/metricas', {
      headers: { 'x-agent-token': 'a'.repeat(64) }, data: metrica,
    }), 401);
    await expectError(await agente.post('agente/metricas', {
      headers: { 'x-agent-token': token }, data: { cpu: 300, ram: 1, disco: 1 },
    }), 422);

    await agente.dispose();
  });

  test('M20.5 - umbral superado abre incidente, no lo repite, y al normalizar lo cierra', async ({ adminApi, playwright }) => {
    // Umbral propio bajo para forzar la alerta sin depender del global.
    await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}`, {
      data: { ...makeNombre('VPS'), ip: ipUnica(), umbralDisco: 50 },
    });

    const agente = await playwright.request.newContext({ baseURL: `${API_BASE}/` });
    const reportar = (disco: number) => agente.post('agente/metricas', {
      headers: { 'x-agent-token': token },
      data: { cpu: 5, ram: 5, disco },
    });

    // 1. Supera el umbral → abre incidente (lo informa en `alertas`).
    const alta = await reportar(80);
    expect((await expectSuccess(alta, 200)).data.alertas).toContain('disco');

    // 2. Sigue mal → NO vuelve a alertar (anti-spam).
    const repite = await reportar(85);
    expect((await expectSuccess(repite, 200)).data.alertas).toEqual([]);

    // 3. Vuelve a la normalidad → el incidente queda resuelto.
    await reportar(10);
    const ficha = await adminApi.get(`${APP_ENDPOINTS.servidores}/${servidorId}`);
    const detalle = (await expectSuccess(ficha, 200)).data;
    const incidentesDisco = (detalle.incidentes as Array<{ tipo: string; resueltoAt: string | null }>)
      .filter(i => i.tipo === 'disco');
    expect(incidentesDisco).toHaveLength(1);
    expect(incidentesDisco[0].resueltoAt).toBeTruthy();

    await agente.dispose();
  });

  test('M20.5b - alertas por servidor: apagar una silencia SOLO esa y cierra su incidente', async ({ adminApi, playwright }) => {
    const agente = await playwright.request.newContext({ baseURL: `${API_BASE}/` });
    const base = { ...makeNombre('VPS'), ip: ipUnica(), umbralCpu: 50, umbralRam: 50 };
    const reportar = (cpu: number, ram = 5) => agente.post('agente/metricas', {
      headers: { 'x-agent-token': token },
      data: { cpu, ram, disco: 5 },
    });
    const abiertos = async (): Promise<string[]> => {
      const ficha = (await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.servidores}/${servidorId}`), 200)).data;
      return (ficha.incidentes as Array<{ tipo: string; resueltoAt: string | null }>)
        .filter(i => !i.resueltoAt).map(i => i.tipo);
    };

    // Compatibilidad: un servidor nace con las cuatro alertas prendidas.
    const previo = (await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.servidores}/${servidorId}`), 200)).data;
    expect(previo.alertaOffline).toBe(true);
    expect(previo.alertaCpu).toBe(true);

    // 1. Con la alerta prendida, la CPU alta abre incidente.
    await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}`, { data: base });
    expect((await expectSuccess(await reportar(95), 200)).data.alertas).toContain('cpu');
    expect(await abiertos()).toContain('cpu');

    // 2. Apagarla cierra el incidente que estaba abierto: si no, quedaría trabado para
    //    siempre (el valor sigue alto, así que nunca vuelve «a la normalidad»).
    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}`, {
      data: { ...base, alertaCpu: false },
    }), 200);
    expect(await abiertos()).not.toContain('cpu');

    // 3. Sigue reportando CPU alta y ya no alerta...
    expect((await expectSuccess(await reportar(97), 200)).data.alertas).toEqual([]);
    expect(await abiertos()).not.toContain('cpu');

    // 4. ...pero la RAM, que quedó prendida, sí: se silenció UNA alerta, no el servidor.
    expect((await expectSuccess(await reportar(97, 90), 200)).data.alertas).toContain('ram');

    // 5. Apagar la alerta NO apaga el monitoreo: la métrica se guardó y el estado se actualizó.
    const ficha = (await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.servidores}/${servidorId}`), 200)).data;
    expect(ficha.estado).toBe('online');
    expect(ficha.ultima.cpu).toBe(97);
    expect(ficha.alertaCpu).toBe(false);
    // Y el incidente silenciado queda en el historial, no se borra.
    expect((ficha.incidentes as Array<{ tipo: string }>).some(i => i.tipo === 'cpu')).toBe(true);

    // Se deja como estaba para los tests que siguen.
    await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}`, { data: { ...base, alertaCpu: true } });
    await reportar(5);
    await agente.dispose();
  });

  test('M20.6 - regenerar el token invalida el anterior', async ({ adminApi, playwright }) => {
    const nuevo = await adminApi.post(`${APP_ENDPOINTS.servidores}/${servidorId}/token`);
    const nuevoToken = (await expectSuccess(nuevo, 200)).data.token;
    expect(nuevoToken).not.toBe(token);

    const agente = await playwright.request.newContext({ baseURL: `${API_BASE}/` });
    // El viejo ya no sirve.
    await expectError(await agente.post('agente/metricas', {
      headers: { 'x-agent-token': token }, data: { cpu: 1, ram: 1, disco: 1 },
    }), 401);
    // El nuevo sí.
    await expectSuccess(await agente.post('agente/metricas', {
      headers: { 'x-agent-token': nuevoToken }, data: { cpu: 1, ram: 1, disco: 1 },
    }), 200);

    token = nuevoToken;
    await agente.dispose();
  });

  test('M20.7 - un servidor de terceros no lleva token (no se le instala agente)', async ({ adminApi }) => {
    const res = await adminApi.post(APP_ENDPOINTS.servidores, {
      data: { ...makeNombre('VPS ajeno'), ip: ipUnica(), monitorea: false, puertoChequeo: 22 },
    });
    const body = await expectSuccess(res, 201);
    cleanup.push(`servidores/${body.data.id}`);
    expect(body.data.token).toBeNull();
  });

  test('M20.8 - sin auth → 401; el fixture (sin servidores:read) → 403; inexistente → 404', async ({ unauthApi, authedApi, adminApi }) => {
    await expectError(await unauthApi.get(APP_ENDPOINTS.servidores), 401);
    await expectError(await authedApi.get(APP_ENDPOINTS.servidores), 403);
    await expectError(await adminApi.get(`${APP_ENDPOINTS.servidores}/99999999`), 404);
  });
});
