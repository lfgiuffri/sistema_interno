/**
 * Ordenar una tabla haciendo clic en el encabezado.
 *
 * Ordena en memoria: sirve para las tablas que traen todos sus datos (la mayoría). Abonos y
 * proyectos paginan en el servidor y ordenan allá — ver `orden`/`dir` en sus stores.
 *
 * El comparador NO es un `<` a secas, porque en estas tablas conviven cosas distintas y cada
 * una tiene su idea de «ordenado»:
 *  - **Números**: 9 va antes que 10 (comparar como texto los deja al revés).
 *  - **Fechas ISO**: se comparan como texto, que para `YYYY-MM-DD` es lo mismo que por fecha.
 *  - **Texto**: comparación local es-AR, sin distinguir acentos ni mayúsculas, para que
 *    «Álvarez» caiga entre «Alvarado» y «Amaya» y no al final.
 *  - **Vacíos**: siempre al final, suba o baje el orden. Un `—` arriba de todo es ruido.
 */
import { ref, computed, type Ref } from 'vue'

export type Direccion = 'asc' | 'desc'

/** Valor que se puede ordenar. */
type Valor = string | number | boolean | null | undefined

const colador = new Intl.Collator('es-AR', { sensitivity: 'base', numeric: true })

/** ¿Parece una fecha ISO (YYYY-MM-DD…)? */
const esFechaISO = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)

/**
 * Compara dos valores para ordenar.
 * @param a - Primer valor.
 * @param b - Segundo valor.
 * @returns Negativo, cero o positivo.
 */
export function compararValores(a: Valor, b: Valor): number {
  const vacioA = a === null || a === undefined || a === ''
  const vacioB = b === null || b === undefined || b === ''
  // Los vacíos van al final SIEMPRE (no se invierten con la dirección).
  if (vacioA && vacioB) return 0
  if (vacioA) return 1
  if (vacioB) return -1

  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b)
  if (esFechaISO(a) && esFechaISO(b)) return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
  return colador.compare(String(a), String(b))
}

/**
 * Estado de orden de una tabla + la lista ya ordenada.
 * @param filas - Las filas (reactivas) a ordenar.
 * @param valorDe - Cómo sacar el valor de una fila para una columna (default: la propiedad).
 * @param inicial - Columna y dirección de arranque.
 */
export function useOrdenTabla<T extends object>(
  filas: Ref<T[]> | (() => T[]),
  valorDe?: (fila: T, columna: string) => Valor,
  inicial?: { columna: string; dir?: Direccion },
) {
  const columna = ref<string>(inicial?.columna ?? '')
  const dir = ref<Direccion>(inicial?.dir ?? 'asc')

  /** Clic en un encabezado: primera vez ascendente, la siguiente invierte. */
  function ordenarPor(col: string): void {
    if (columna.value === col) dir.value = dir.value === 'asc' ? 'desc' : 'asc'
    else { columna.value = col; dir.value = 'asc' }
  }

  const ordenadas = computed<T[]>(() => {
    const base = typeof filas === 'function' ? filas() : filas.value
    if (!columna.value) return base
    const signo = dir.value === 'asc' ? 1 : -1
    // Copia: ordenar in-place mutaría el array del store.
    return [...base].sort((a, b) => {
      // `as` obligado: las filas son interfaces, y una interfaz de TS no tiene index
      // signature implícita, así que no se la puede indexar por un string variable.
      const leer = (f: T): Valor => (f as Record<string, Valor>)[columna.value]
      const va = valorDe ? valorDe(a, columna.value) : leer(a)
      const vb = valorDe ? valorDe(b, columna.value) : leer(b)
      return compararValores(va, vb) * signo
    })
  })

  return { columna, dir, ordenarPor, ordenadas }
}

/**
 * Estado de orden para una tabla que ordena en el SERVIDOR (listados paginados).
 *
 * Misma interfaz que `useOrdenTabla` para que el encabezado sea idéntico, pero sin `ordenadas`:
 * acá el clic dispara un pedido nuevo. Ordenar en el navegador una tabla paginada ordenaría
 * solo la página visible y mentiría sobre el resto.
 * @param alCambiar - Se llama con la columna y la dirección nuevas (debe recargar el listado).
 */
export function useOrdenRemoto(alCambiar: (columna: string, dir: Direccion) => void) {
  const columna = ref<string>('')
  const dir = ref<Direccion>('asc')

  function ordenarPor(col: string): void {
    if (columna.value === col) dir.value = dir.value === 'asc' ? 'desc' : 'asc'
    else { columna.value = col; dir.value = 'asc' }
    alCambiar(columna.value, dir.value)
  }

  /** Params para el pedido (vacío mientras no se eligió columna: manda el orden por defecto). */
  const params = computed(() => (columna.value ? { orden: columna.value, dir: dir.value } : {}))

  return { columna, dir, ordenarPor, params }
}
