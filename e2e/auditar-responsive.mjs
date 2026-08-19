/**
 * Auditoría de responsive: recorre TODAS las vistas en un viewport de celular y mide, en vez
 * de mirar a ojo.
 *
 * El síntoma de «se ve roto» en un celular es casi siempre el mismo: la página entera scrollea
 * de costado. Eso se detecta comparando `scrollWidth` con el ancho del viewport, y después se
 * busca cuál es el elemento culpable — el que sobresale sin estar dentro de un contenedor con
 * scroll propio (una tabla en `overflow-x-auto` sobresale a propósito y NO es un problema).
 *
 * Uso:  node auditar-responsive.mjs [ruta-de-salida]
 */
import { chromium, devices } from 'playwright';
import fs from 'fs';

const API = 'http://localhost:3000/api';
const APP = 'http://localhost:8100';
const SALIDA = process.argv[2] || '/tmp/responsive';
const USUARIO = { username: 'leonel', password: 'LeoPositive1764' };

/** iPhone 12/13 mini: uno de los anchos reales más chicos que sigue siendo común. */
const CELULAR = { width: Number(process.argv[3] || 390), height: 844 };

const IDS = { abono: 20, proyecto: 2, empleado: 2, espacio: 2, lista: null, docEspacio: 3, docLista: 3, servidor: 65 };

const RUTAS = [
  ['/panel', 'Panel'],
  ['/estadisticas', 'Estadísticas'],
  ['/abonos', 'Abonos'],
  ['/abonos/nuevo', 'Abono nuevo'],
  [`/abonos/${IDS.abono}/editar`, 'Abono editar'],
  ['/facturaciones', 'Facturaciones'],
  ['/proyectos', 'Proyectos'],
  ['/proyectos/nuevo', 'Proyecto nuevo'],
  [`/proyectos/${IDS.proyecto}/editar`, 'Proyecto editar'],
  [`/proyectos/${IDS.proyecto}/cobranzas`, 'Cobranzas del proyecto'],
  ['/grilla-cobranzas', 'Grilla de cobranzas'],
  ['/tareas', 'Tareas (home)'],
  ['/tareas/resumen', 'Tareas resumen'],
  [`/tareas/espacios/${IDS.espacio}`, 'Listas de un espacio'],
  ['/documentacion', 'Documentación (home)'],
  ['/documentacion/espacios', 'Espacios de docs'],
  [`/documentacion/espacios/${IDS.docEspacio}`, 'Listas de documentación'],
  [`/documentacion/espacios/${IDS.docEspacio}/listas/${IDS.docLista}`, 'Documentos'],
  ['/mantenimiento/servidores', 'Servidores'],
  [`/mantenimiento/servidores/${IDS.servidor}`, 'Ficha de servidor'],
  ['/mantenimiento/sitios', 'Sitios web'],
  ['/espacios', 'Espacios de trabajo'],
  ['/empleados', 'Empleados'],
  ['/empleados/nuevo', 'Empleado nuevo'],
  [`/empleados/${IDS.empleado}`, 'Ficha de empleado'],
  [`/empleados/${IDS.empleado}/editar`, 'Empleado editar'],
  ['/sueldos', 'Sueldos'],
  ['/sueldos/aumentos', 'Aumentos'],
  ['/sueldos/planificacion', 'Planificación'],
  ['/sueldos/cuentas', 'Cuentas de pago'],
  ['/clientes', 'Clientes'],
  ['/servicios', 'Servicios'],
  ['/areas', 'Áreas'],
  ['/formas-facturacion', 'Formas de facturación'],
  ['/usuarios', 'Usuarios'],
  ['/roles', 'Roles'],
  ['/configuracion', 'Configuración'],
];

/**
 * Mide desbordes dentro de la página. Corre en el browser.
 * @returns {object} Diagnóstico del viewport actual.
 */
const medir = () => {
  const W = window.innerWidth;
  const raiz = document.documentElement;

  // ¿Scrollea de costado alguno de los contenedores que hacen de "página"?
  const candidatos = [raiz, document.body, ...document.querySelectorAll('ion-content, .ion-page, ion-router-outlet')];
  let scrollPagina = 0;
  for (const el of candidatos) {
    if (!el) continue;
    const extra = el.scrollWidth - el.clientWidth;
    if (extra > scrollPagina) scrollPagina = extra;
  }

  /** ¿El elemento está dentro de algo que scrollea de costado a propósito? */
  const enContenedorConScroll = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };

  // Culpables: sobresalen del viewport, no están en un contenedor con scroll, y son los más
  // externos (si el padre ya sobresale, el hijo es consecuencia y no causa).
  const culpables = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const excede = Math.round(r.right - W);
    if (excede <= 1) continue;
    if (enContenedorConScroll(el)) continue;
    const pr = el.parentElement?.getBoundingClientRect();
    if (pr && pr.right - W > 1) continue;   // el padre ya sobresale: no es la causa
    culpables.push({
      tag: el.tagName.toLowerCase(),
      clases: (el.className || '').toString().slice(0, 90),
      texto: (el.textContent || '').trim().slice(0, 45),
      ancho: Math.round(r.width),
      excede,
    });
  }

  // Botones/enlaces demasiado chicos para el dedo (mínimo recomendado 44px, se avisa < 32).
  let tactilesChicos = 0;
  for (const el of document.querySelectorAll('button, a, [role=button], ion-icon')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.width < 32 || r.height < 32)) tactilesChicos++;
  }

  // ── El síntoma que de verdad se ve «roto» ────────────────────────────────────────
  // Texto que NO ENTRA en su caja: se pisa con el de al lado o se corta. Es lo que pasa
  // cuando una tabla de 15 columnas se comprime en 390px, y no produce scroll de página
  // (justamente porque está comprimida), así que el chequeo anterior no lo veía.
  const apretados = [];
  for (const el of document.querySelectorAll('td, th, span, p, div, a, button, label')) {
    if (el.children.length > 0) continue;               // solo hojas (las que tienen el texto)
    const txt = (el.textContent || '').trim();
    if (!txt) continue;
    const sobra = el.scrollWidth - el.clientWidth;
    if (sobra <= 2) continue;

    const cs = getComputedStyle(el);
    // `sr-only`: mide 1px a propósito, es para lectores de pantalla. No es un problema visual.
    if (el.classList.contains('sr-only') || (el.clientWidth <= 1 && cs.position === 'absolute')) continue;
    // Truncado DELIBERADO con puntos suspensivos: el diseño ya decidió cortar ahí.
    if (cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible') continue;

    apretados.push({ tag: el.tagName.toLowerCase(), texto: txt.slice(0, 30), caja: el.clientWidth, necesita: el.scrollWidth });
  }

  // Columnas tan finas que su propio encabezado no entra. Una columna angosta cuyo texto SÍ
  // entra no es un problema (un mes vacío puede ser finito y leerse perfecto), así que la
  // condición es que además esté apretada.
  const columnasFinas = [...document.querySelectorAll('th')]
    .filter(th => th.scrollWidth - th.clientWidth > 2)
    .map(th => ({ texto: (th.textContent || '').trim().slice(0, 14), ancho: Math.round(th.getBoundingClientRect().width) }))
    .filter(c => c.texto && !c.texto.match(/^(Acciones|Seleccionar|Prioridad)$/));

  return {
    scrollPagina,
    culpables: culpables.slice(0, 6),
    tactilesChicos,
    apretados: apretados.slice(0, 8),
    totalApretados: apretados.length,
    columnasFinas: columnasFinas.slice(0, 8),
  };
};

const login = await (await fetch(`${API}/auth/signin`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(USUARIO),
})).json();
if (!login?.data?.accessToken) { console.error('no se pudo loguear'); process.exit(1); }

fs.mkdirSync(SALIDA, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13 Mini'], viewport: CELULAR, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errores = [];
page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });

await page.goto(`${APP}/login`);
await page.evaluate(([a, r]) => {
  localStorage.setItem('accessToken', a); localStorage.setItem('refreshToken', r);
}, [login.data.accessToken, login.data.refreshToken]);

const informe = [];
for (const [ruta, nombre] of RUTAS) {
  await page.goto(`${APP}${ruta}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);   // datos + render de Ionic
  const d = await page.evaluate(medir);
  const archivo = `${SALIDA}/${nombre.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  await page.screenshot({ path: archivo, fullPage: false });
  informe.push({ nombre, ruta, ...d, archivo });

  const problema = d.scrollPagina > 1 || d.totalApretados > 0 || d.columnasFinas.length > 0;
  const partes = [];
  if (d.scrollPagina > 1) partes.push(`scroll +${d.scrollPagina}px`);
  if (d.totalApretados) partes.push(`${d.totalApretados} texto(s) que no entran`);
  if (d.columnasFinas.length) partes.push(`${d.columnasFinas.length} columna(s) < 45px`);
  console.log(`${problema ? '❌' : '✅'}  ${nombre.padEnd(26)} ${partes.join(' · ')}`);
}

fs.writeFileSync(`${SALIDA}/informe.json`, JSON.stringify({ viewport: CELULAR, informe, errores }, null, 1));
const roto = informe.filter(i => i.scrollPagina > 1 || i.totalApretados > 0 || i.columnasFinas.length > 0);
console.log(`\n=== ${roto.length} de ${informe.length} vistas con problemas en ${CELULAR.width}px ===`);
roto.sort((a, b) => (b.totalApretados + b.scrollPagina) - (a.totalApretados + a.scrollPagina)).forEach(i => {
  console.log(`\n▸ ${i.nombre}   ${i.scrollPagina > 1 ? `scroll de página +${i.scrollPagina}px` : ''}`);
  i.culpables.forEach(c => console.log(`   desborda: ${c.tag}.${c.clases.split(' ').slice(0,4).join('.')} (excede ${c.excede}px) «${c.texto}»`));
  i.apretados.forEach(c => console.log(`   no entra: <${c.tag}> «${c.texto}» — caja ${c.caja}px, necesita ${c.necesita}px`));
  if (i.columnasFinas.length) console.log(`   columnas finas: ${i.columnasFinas.map(c => `${c.texto}=${c.ancho}px`).join(', ')}`);
});
console.log('\nerrores de consola:', errores.length ? [...new Set(errores)].slice(0,5).join(' | ') : 'ninguno');
await browser.close();
