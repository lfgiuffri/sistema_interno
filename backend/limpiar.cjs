require('dotenv').config();
const mysql = require('mysql2/promise');

// Subconsultas que definen QUÉ es basura de e2e. Cada una lleva la firma `E2E <ts>-<rnd>`
// que generan las factories del suite; ningún dato real la tiene (se verificó por muestreo).
const USERS   = "SELECT id FROM users WHERE (username LIKE 'e2e-%' AND username <> 'e2e-fixture') OR username LIKE 'zzmenu%'";
const ESPACIOS= "SELECT id FROM espacios_trabajo WHERE nombre LIKE '%E2E%'";
const SITIOS  = "SELECT id FROM sitios_web WHERE nombre LIKE '%E2E%'";
const TAREAS  = `SELECT id FROM tareas WHERE espacioId IN (${ESPACIOS})`;
const LISTAS  = `SELECT id FROM listas WHERE espacioId IN (${ESPACIOS})`;
const VISTAS  = `SELECT id FROM sitio_vistas WHERE sitioId IN (${SITIOS})`;

// ORDEN: hijos antes que padres. Con 72 FKs reales en el schema, al revés falla.
const PASOS = [
  // Tareas de espacios e2e y todo lo que cuelga de ellas.
  ['tarea_archivos',    `DELETE FROM tarea_archivos    WHERE tareaId IN (${TAREAS})`],
  ['tarea_cambios',     `DELETE FROM tarea_cambios     WHERE tareaId IN (${TAREAS})`],
  ['tarea_comentarios', `DELETE FROM tarea_comentarios WHERE tareaId IN (${TAREAS})`],
  ['tarea_estados',     `DELETE FROM tarea_estados     WHERE tareaId IN (${TAREAS})`],
  ['tareas',            `DELETE FROM tareas            WHERE espacioId IN (${ESPACIOS})`],
  ['listas',            `DELETE FROM listas            WHERE espacioId IN (${ESPACIOS})`],
  ['usuario_espacios',  `DELETE FROM usuario_espacios  WHERE espacioId IN (${ESPACIOS}) OR userId IN (${USERS})`],
  ['espacios_trabajo',  `DELETE FROM espacios_trabajo  WHERE nombre LIKE '%E2E%'`],
  // Sitios web de prueba: el grueso son los chequeos minuto a minuto.
  ['sitio_velocidad_dia', `DELETE FROM sitio_velocidad_dia WHERE vistaId IN (${VISTAS})`],
  ['sitio_chequeos',    `DELETE FROM sitio_chequeos    WHERE sitioId IN (${SITIOS})`],
  ['sitio_incidentes',  `DELETE FROM sitio_incidentes  WHERE sitioId IN (${SITIOS})`],
  ['sitio_vistas',      `DELETE FROM sitio_vistas      WHERE sitioId IN (${SITIOS})`],
  ['sitios_web',        `DELETE FROM sitios_web        WHERE nombre LIKE '%E2E%'`],
  // Catálogos (ningún abono real los referencia: verificado antes).
  ['formas_facturacions', `DELETE FROM formas_facturacions WHERE nombre LIKE '%E2E%'`],
  // Lo que cuelga de los usuarios de prueba.
  ['userSettings',        `DELETE FROM userSettings        WHERE userId IN (${USERS})`],
  ['push_subscriptions',  `DELETE FROM push_subscriptions  WHERE userId IN (${USERS})`],
  ['webhook_subscriptions',`DELETE FROM webhook_subscriptions WHERE userId IN (${USERS})`],
  ['usuario_doc_espacios',`DELETE FROM usuario_doc_espacios WHERE userId IN (${USERS})`],
  ['embedding_items',     `DELETE FROM embedding_items     WHERE userId IN (${USERS})`],
  ['errorLogs (de usuarios e2e)', `DELETE FROM errorLogs    WHERE userId IN (${USERS})`],
  ['users',               `DELETE FROM users               WHERE id IN (SELECT id FROM (${USERS}) x)`],
  // Logs sueltos: por su propio texto, incluyen corridas sin usuario asociado.
  ['login_attempts',  `DELETE FROM login_attempts  WHERE username LIKE 'e2e-%' OR username LIKE 'zzmenu%'`],
  ['notificaciones',  `DELETE FROM notificaciones  WHERE titulo LIKE '%E2E%' OR cuerpo LIKE '%E2E%' OR titulo LIKE '%e2e-%' OR cuerpo LIKE '%e2e-%'`],
  ['actionTrackings', `DELETE FROM actionTrackings WHERE url LIKE '%e2e%' OR body LIKE '%E2E%' OR body LIKE '%e2e-%' OR header LIKE '%Playwright%'`],
];

(async () => {
  const seco = !process.argv.includes('--aplicar');
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME, multipleStatements: false });
  console.log(seco ? '  MODO PRUEBA (contando, sin borrar)\n' : '  APLICANDO\n');
  await c.beginTransaction();
  let total = 0;
  try {
    for (const [etiqueta, sql] of PASOS) {
      if (seco) {
        const [[{ n }]] = await c.query(sql.replace(/^DELETE FROM (\S+)/, 'SELECT COUNT(*) n FROM $1'));
        if (n) { console.log(`  ${String(n).padStart(7)}  ${etiqueta}`); total += n; }
      } else {
        const [r] = await c.query(sql);
        if (r.affectedRows) { console.log(`  ${String(r.affectedRows).padStart(7)}  ${etiqueta}`); total += r.affectedRows; }
      }
    }
    if (seco) { await c.rollback(); } else { await c.commit(); }
    console.log(`  ${String(total).padStart(7)}  TOTAL`);
  } catch (e) {
    await c.rollback();
    console.log('  ✗ FALLÓ, se revirtió todo:', e.message);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => console.log('ERR', e.message));
