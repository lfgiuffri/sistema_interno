/**
 * Auditoría de responsive de los MODALES.
 *
 * La auditoría de páginas no los ve porque hay que abrirlos. Y son el lugar donde el diseño
 * de escritorio suele romperse más fuerte en un celular: `ds-modal-lg`/`ds-modal-xl` fijan
 * anchos de 880 y 1120px, y varios usan dos columnas.
 *
 * Uso:  node auditar-modales.mjs [ruta-de-salida] [ancho]
 */
import { chromium } from 'playwright';
import fs from 'fs';

const API = 'http://localhost:3000/api';
const APP = 'http://localhost:8100';
const SALIDA = process.argv[2] || '/tmp/modales';
const ANCHO = Number(process.argv[3] || 390);

/** Cada caso: a dónde ir y cómo abrir el modal. */
const CASOS = [
  { nombre: 'Tarea (crear)', ruta: '/tareas/espacios/94/listas/348', abrir: p => p.getByRole('button', { name: /nueva tarea|agregar tarea/i }).first().click() },
  { nombre: 'Documento (crear)', ruta: '/documentacion/espacios/3/listas/3', abrir: p => p.getByRole('button', { name: /nuevo documento/i }).first().click() },
  { nombre: 'Sitio web (crear)', ruta: '/mantenimiento/sitios', abrir: p => p.getByRole('button', { name: /nuevo sitio/i }).first().click() },
  { nombre: 'Servidor (crear)', ruta: '/mantenimiento/servidores', abrir: p => p.getByRole('button', { name: /nuevo servidor/i }).first().click() },
  { nombre: 'Rol (crear)', ruta: '/roles', abrir: p => p.getByRole('button', { name: /nuevo rol/i }).first().click() },
  { nombre: 'Usuario (crear)', ruta: '/usuarios', abrir: p => p.getByRole('button', { name: /nuevo usuario/i }).first().click() },
  { nombre: 'Cotización (panel)', ruta: '/panel', abrir: p => p.getByRole('button', { name: /dólar/i }).first().click() },
  { nombre: 'Cliente (crear)', ruta: '/clientes', abrir: p => p.getByRole('button', { name: /nuevo|agregar/i }).first().click() },
  { nombre: 'Historial de sueldo', ruta: '/sueldos', abrir: p => p.locator('button[title="Historial"], button[aria-label*="istorial"]').first().click() },
];

/** Mide el modal abierto. Corre en el browser. */
const medir = () => {
  const W = window.innerWidth;
  const modal = document.querySelector('.ds-modal');
  if (!modal) return { sinModal: true };
  const r = modal.getBoundingClientRect();

  const apretados = [];
  for (const el of modal.querySelectorAll('td, th, span, p, div, a, button, label, h2, h3')) {
    if (el.children.length > 0) continue;
    if (!(el.textContent || '').trim()) continue;
    if (el.scrollWidth - el.clientWidth <= 2) continue;
    const cs = getComputedStyle(el);
    if (el.classList.contains('sr-only')) continue;
    if (cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible') continue;
    apretados.push({ texto: (el.textContent || '').trim().slice(0, 28), caja: el.clientWidth, necesita: el.scrollWidth });
  }

  // ¿El modal se sale del viewport, a izquierda o a derecha?
  const sobresale = Math.max(0, Math.round(r.right - W)) + Math.max(0, Math.round(-r.left));
  // ¿Se puede llegar al final (botón de guardar) sin que el modal desborde la pantalla?
  const masAltoQueLaPantalla = r.height > window.innerHeight + 2;
  const cs = getComputedStyle(modal);

  return {
    ancho: Math.round(r.width), viewport: W, sobresale,
    masAltoQueLaPantalla, overflowY: cs.overflowY,
    columnas: modal.querySelectorAll('.grid').length,
    apretados: apretados.slice(0, 6), totalApretados: apretados.length,
  };
};

const login = await (await fetch(`${API}/auth/signin`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'leonel', password: 'LeoPositive1764' }),
})).json();

fs.mkdirSync(SALIDA, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: ANCHO, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${APP}/login`);
await page.evaluate(([a, r]) => { localStorage.setItem('accessToken', a); localStorage.setItem('refreshToken', r); },
  [login.data.accessToken, login.data.refreshToken]);

console.log(`=== modales en ${ANCHO}px ===`);
for (const caso of CASOS) {
  await page.goto(`${APP}${caso.ruta}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  try {
    await caso.abrir(page);
  } catch {
    console.log(`⚠️  ${caso.nombre.padEnd(22)} no se pudo abrir (botón no encontrado)`);
    continue;
  }
  await page.waitForTimeout(1200);
  const d = await page.evaluate(medir);
  if (d.sinModal) { console.log(`⚠️  ${caso.nombre.padEnd(22)} no se abrió ningún .ds-modal`); continue; }

  const mal = d.sobresale > 1 || d.totalApretados > 0;
  const partes = [`ancho ${d.ancho}px`];
  if (d.sobresale > 1) partes.push(`SE SALE ${d.sobresale}px`);
  if (d.totalApretados) partes.push(`${d.totalApretados} texto(s) que no entran`);
  if (d.masAltoQueLaPantalla && d.overflowY !== 'auto' && d.overflowY !== 'scroll') partes.push('más alto que la pantalla SIN scroll propio');
  console.log(`${mal ? '❌' : '✅'}  ${caso.nombre.padEnd(22)} ${partes.join(' · ')}`);
  d.apretados.forEach(a => console.log(`      «${a.texto}» caja ${a.caja}px, necesita ${a.necesita}px`));
  await page.screenshot({ path: `${SALIDA}/${caso.nombre.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png` });
}
await browser.close();
