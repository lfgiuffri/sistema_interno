# Ordenar tablas por columna

> ⚠️ **Keep in sync.** Frontend: `composables/useOrdenTabla.ts` + `components/shared/ThOrdenable.vue`.
> Backend: `kernel/ordenTabla.js` (exportado por el barrel) + el catálogo de columnas de cada service.

Cualquier encabezado de tabla es un botón: el primer clic ordena ascendente, el segundo invierte.
El `<th>` lleva `aria-sort`, así que un lector de pantalla anuncia el estado.

## Dos mecanismos, según pagine o no

| | Composable | Dónde ordena | Cuándo |
|---|---|---|---|
| Tabla completa en memoria | `useOrdenTabla` | navegador | el listado trae **todas** sus filas |
| Listado paginado | `useOrdenRemoto` | servidor | el listado viene por páginas |

**Por qué la distinción importa:** hay 76 abonos en páginas de 50. Ordenar en el navegador
ordenaría las 50 visibles y dejaría las otras 26 donde estaban — la tabla se vería ordenada y
no lo estaría. Con paginación, el orden tiene que ser parte de la consulta.

Las tres pantallas paginadas son **Abonos**, **Facturaciones** y **Proyectos**. El resto ordena
en memoria.

## El comparador (memoria)

`compararValores` no es un `<` a secas, porque en estas tablas conviven cosas distintas:

- **Números**: 9 antes que 10 (como texto quedarían al revés).
- **Fechas ISO**: se comparan como texto — para `YYYY-MM-DD` es lo mismo que por fecha.
- **Texto**: `Intl.Collator('es-AR', { sensitivity: 'base', numeric: true })`, así «Álvarez» cae
  entre «Alvarado» y «Amaya» en vez de irse al final.
- **Vacíos**: **siempre** al final, suba o baje el orden. Un `—` arriba de todo es ruido.

`ordenadas` devuelve una **copia**: ordenar in-place mutaría el array del store.

### Columnas que no son una propiedad

Cuando la columna no es un campo plano de la fila se pasa un accesor:

```ts
const orden = useOrdenTabla(
  () => store.servidores,
  (s, col) => (['cpu', 'ram', 'disco'].includes(col) ? s.ultima?.[col] ?? null : s[col]),
)
```

Casos ya resueltos así: CPU/RAM/disco (viven dentro de `ultima`), «Asignada a» (ordena por el
nombre visible, no por el id), «Usuarios con acceso» (ordena por **cantidad**, que es el dato
útil de esa columna) y «Período» en cobranzas (`anio * 100 + mes`, porque por el nombre del mes
daría abril, agosto, diciembre).

### Tablas anidadas

El resumen de tareas viene agrupado espacio → lista → tarea, pero la tabla es plana. Se
**aplana una vez** (`filas`) y cada sección filtra por su espacio: sin eso no habría cómo
ordenar por «Lista», que es justamente el criterio que agrupa. Las secciones siguen agrupadas
por espacio; lo que se reordena es el contenido de cada una.

## El orden en el servidor

`ordenSeguro(query, permitidas, porDefecto)` traduce `?orden=<col>&dir=<asc|desc>` al `order`
de Sequelize. La columna **nunca** se interpola en SQL: se busca en un mapa cerrado que declara
cada service.

```js
const ordenAbonos = (models) => ({
    cliente: [[models.Cliente, 'nombre', 'ASC']],
    precio: [['moneda', 'ASC'], ['precio', 'ASC']],
    ...
});
// ...
order: ordenSeguro(query, ordenAbonos(models), [[models.Cliente, 'nombre', 'ASC'], ['fechaInicio', 'ASC']]),
```

Tres detalles que cuestan un rato si se descubren en producción:

1. **Una columna desconocida no es un error**: cae al orden por defecto. Así el frontend puede
   ofrecer una columna que el backend todavía no soporta sin romper el listado (y `?orden=DROP
   TABLE` es inofensivo por construcción, no por escaparlo).
2. **Ordenar por un include exige el MODELO**, no el nombre de la asociación: con un string,
   Sequelize lo toma como parte del nombre de la columna y arma ``abonos.Cliente`nombre``.
3. **Desempate por `id`** al final de todo orden. Sin eso, dos filas con el mismo valor pueden
   saltar de página en página entre pedidos: el usuario ve una fila repetida y otra ausente.

El orden por defecto de cada listado se conserva cuando no se pide nada — en proyectos eso
significa que siguen apareciendo los abiertos primero y los cerrados al final, como en el legado.

Cambiar de columna vuelve a la **página 1**: ordenar por otra cosa y quedarse en la página 4 no
tiene sentido.
