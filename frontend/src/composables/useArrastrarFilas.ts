/**
 * Reordenar filas de una tabla arrastrándolas.
 *
 * Va con **pointer events** y no con el drag & drop nativo de HTML5 a propósito: el nativo no
 * existe en pantallas táctiles, y este sistema se usa desde el celular todos los días. Con
 * `pointerdown/move/up` el mismo código sirve para el mouse y para el dedo; lo único que hace
 * falta es `touch-action: none` en la manija (lo pone la clase `manija-arrastre`), para que
 * el navegador no interprete el gesto como scroll de la página.
 *
 * La reordenación se ve EN VIVO mientras se arrastra (la fila se va corriendo bajo el dedo) y
 * recién al soltar se avisa quién quedó dónde. Si el guardado falla, la vista se recarga y el
 * orden vuelve al que tiene el servidor: nunca queda una pantalla que miente.
 */
import { ref, onUnmounted } from 'vue'

export interface OpcionesArrastre<T> {
  /** Las filas actuales, en el orden que se ve. */
  filas: () => T[]
  /** Aplica el orden nuevo en la vista (optimista, antes de que responda el servidor). */
  aplicar: (filas: T[]) => void
  /** Persiste el orden nuevo. Si devuelve false, se recarga para volver a la verdad. */
  guardar: (filas: T[]) => Promise<boolean>
  /** ¿Esta fila se puede mover? (las completadas viven al fondo y no se acomodan). */
  movible: (fila: T) => boolean
}

export function useArrastrarFilas<T>(opciones: OpcionesArrastre<T>) {
  /** Índice de la fila que se está arrastrando (null = no hay arrastre en curso). */
  const arrastrando = ref<number | null>(null)
  /** Se movió algo de lugar: si no, soltar no guarda nada (fue un clic, no un arrastre). */
  let hubieronCambios = false

  /** Fila (por su `data-fila`) que está debajo del puntero, o null si no hay ninguna. */
  function filaBajoElPuntero(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest('[data-fila]')
    const idx = el ? Number((el as HTMLElement).dataset.fila) : NaN
    return Number.isInteger(idx) ? idx : null
  }

  function alMover(e: PointerEvent): void {
    if (arrastrando.value === null) return
    e.preventDefault()
    const destino = filaBajoElPuntero(e.clientX, e.clientY)
    if (destino === null || destino === arrastrando.value) return

    const filas = [...opciones.filas()]
    // No se puede soltar sobre una fila que no se mueve (una completada): la zona del fondo
    // está fuera de juego y el arrastre simplemente no avanza más allá.
    if (!opciones.movible(filas[destino])) return

    const [movida] = filas.splice(arrastrando.value, 1)
    filas.splice(destino, 0, movida)
    opciones.aplicar(filas)
    arrastrando.value = destino
    hubieronCambios = true
  }

  async function alSoltar(): Promise<void> {
    const habia = arrastrando.value !== null && hubieronCambios
    arrastrando.value = null
    hubieronCambios = false
    desenganchar()
    if (habia) await opciones.guardar(opciones.filas())
  }

  function enganchar(): void {
    window.addEventListener('pointermove', alMover, { passive: false })
    window.addEventListener('pointerup', alSoltar)
    window.addEventListener('pointercancel', alSoltar)
  }
  function desenganchar(): void {
    window.removeEventListener('pointermove', alMover)
    window.removeEventListener('pointerup', alSoltar)
    window.removeEventListener('pointercancel', alSoltar)
  }

  /**
   * Empieza el arrastre desde la manija de una fila.
   * @param indice - Posición de la fila en la lista visible.
   * @param e - Evento del puntero.
   */
  function empezar(indice: number, e: PointerEvent): void {
    if (e.button !== undefined && e.button > 0) return   // solo el botón principal
    e.preventDefault()
    arrastrando.value = indice
    hubieronCambios = false
    enganchar()
  }

  // Si la vista se desmonta a mitad de un arrastre, los listeners globales quedarían vivos.
  onUnmounted(desenganchar)

  return { arrastrando, empezar }
}
