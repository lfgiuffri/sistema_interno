# Responsive — Sistema Interno

> ⚠️ **Keep in sync.** Las auditorías viven en `e2e/auditar-responsive.mjs` (páginas) y `e2e/auditar-modales.mjs` (modales).

El sistema se usa **a diario desde el celular**, no solo desde la oficina. Esta guía es el resultado de auditar las 37 vistas a 320, 360 y 390px: qué se mide, qué se rompió y qué reglas evitan que vuelva a pasar.

## Cómo auditar (no mirar a ojo)

```bash
# Requiere backend en :3000 (o ajustar API en el script) y frontend en :8100
cd e2e
node auditar-responsive.mjs /tmp/resp 390    # todas las páginas a 390px
node auditar-modales.mjs   /tmp/mod  390     # todos los modales
```

Imprime una línea por vista, deja los screenshots en la carpeta indicada y un `informe.json`. Corrélo a **320, 360 y 390**: 390 es un iPhone típico, 360 el Android más común, y 320 es el peor caso realista — el que destapa los layouts frágiles.

## Qué mide, y por qué no alcanza con lo obvio

El primer intento midió lo que todo el mundo mide: **¿la página scrollea de costado?** (`scrollWidth > clientWidth`). Dio **0 problemas en 37 vistas**… con la grilla de cobranzas ilegible en pantalla.

La razón es importante: la grilla tenía `width: 100%; table-layout: fixed`, así que **no desbordaba — se comprimía**. Quince columnas en 390px dejan 21px por mes: los encabezados se pisaban entre sí (`PROYEPRESUFEEBMOAR…`) y los montos se partían en cuatro renglones. Cero scroll horizontal, cero utilidad.

La medición que sí encuentra esto es **texto que no entra en su caja**: para cada elemento con texto, `scrollWidth > clientWidth`. Descontando dos falsos positivos legítimos:

- `.sr-only` — mide 1px a propósito, es para lectores de pantalla.
- Truncado deliberado — `text-overflow: ellipsis` con `overflow` oculto: el diseño ya decidió cortar ahí.

Y una tercera métrica, ya afinada: **columna cuyo propio encabezado no entra**. Una columna angosta cuyo texto *sí* entra no es un problema (un mes vacío puede ser finito y leerse perfecto).

## Reglas

**1. Una tabla ancha se recorre, no se comprime.**
Con más de ~6 columnas, forzar `width: 100%` en un celular no la hace chica: la hace ilegible. Dale un `min-width` y dejá que se desplace dentro de su contenedor con `overflow-x-auto`.

```css
@media (max-width: 1023px) {
  .mi-tabla { width: auto; min-width: 900px; table-layout: auto; }
}
```

**2. Si la tabla se recorre, la primera columna va fija.**
Sin eso, al llegar a Septiembre no sabés de qué fila es el número que estás mirando. Necesita **fondo opaco** (si no, se ve pasar el contenido por debajo) y acompañar el `:hover` de la fila:

```css
.col-clave { position: sticky; left: 0; z-index: 2; background: rgb(var(--s-surface)); box-shadow: 1px 0 0 rgb(var(--s-line)); }
thead .col-clave { z-index: 3; }
tbody tr:hover .col-clave { background: rgb(var(--s-surface-2)); }
```

**3. Una fila `label` + `control` se apila en celular.**
El patrón `display: flex; justify-content: space-between` con el control en `flex-shrink: 0` le descuenta al texto todo el ancho que falta. Con `min-width: 0` en el texto —que hace falta para otras cosas— la etiqueta puede llegar a **0px** y el título sale *una letra por renglón*. Es exactamente lo que pasaba en Configuración a 320px.

```css
@media (max-width: 640px) {
  .setting-row { flex-direction: column; align-items: stretch; }
  .setting-row-control { width: 100%; }
}
```

**4. Los encabezados en mayúsculas necesitan más ancho del que parece.**
`PRESUPUESTO` con `text-transform: uppercase` y `letter-spacing` pide ~87px. La columna tenía 7% (~80px) y se cortaba **también en escritorio**. Medí el encabezado, no la palabra.

**5. Una tira de pestañas se desplaza, no se apila.**
`overflow-x: auto` + `flex-shrink: 0` en cada pestaña + `scrollbar-width: none`. Que la última quede cortada es la señal correcta de «hay más para el costado». Así ya funciona la de Configuración.

**6. Los modales no necesitan nada especial.**
`ds-modal` y sus variantes usan `max-width`, no `width`, así que se adaptan solos: los 9 modales auditados entran bien hasta en 320px, y los de dos columnas (tareas, documentos) se apilan por el `grid` de Tailwind con prefijo `lg:`. Al agregar un modal, usá `max-width` y prefijá las grillas con `lg:`.

## Estado actual

| Ancho | Páginas | Modales |
|---|---|---|
| 320px | 37/37 ✅ | 9/9 ✅ |
| 360px | 37/37 ✅ | — |
| 390px | 37/37 ✅ | 9/9 ✅ |

Escritorio (1280 y 1440) verificado sin regresiones después de los arreglos.
