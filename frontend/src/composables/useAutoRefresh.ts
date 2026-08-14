/**
 * Refresco automático de una vista, pensado para dejarla abierta en un monitor.
 *
 * Tres cuidados que un `setInterval` pelado no tiene:
 *  - **No pega cuando nadie mira**: si la pestaña queda oculta se suspende, y al volver
 *    refresca enseguida (los datos que quedaron en pantalla ya están viejos).
 *  - **No se superpone**: si una consulta tarda más que el intervalo, el tick siguiente se
 *    saltea en vez de encimar pedidos.
 *  - **No grita**: los errores no se muestran; se cuentan. Un corte de red momentáneo en una
 *    pantalla que se refresca sola no tiene que llenar de toasts al que pasa por al lado.
 *
 * El reloj corre cada 10 segundos —no cada intervalo— para poder mostrar «hace N» sin otro
 * temporizador aparte.
 */
import { ref, computed, onUnmounted, type Ref } from 'vue'

/** Cada cuánto late el reloj interno (y se recalcula el «hace N»). */
const TICK_MS = 10_000

export interface AutoRefresh {
  /** Si el refresco automático está encendido (se persiste). */
  activo: Ref<boolean>
  /** Momento de la última actualización exitosa. */
  ultima: Ref<Date | null>
  /** Texto legible del tiempo transcurrido («hace 2 min»). */
  hace: Ref<string>
  /** Fallos seguidos de la última tanda (0 = todo bien). */
  fallos: Ref<number>
  /** Fuerza una actualización ahora. */
  refrescarAhora: () => Promise<void>
  /** Avisa que la vista ya cargó los datos por su cuenta (la carga inicial, con skeleton). */
  marcarCargado: () => void
  /** Enciende el reloj (llamalo al entrar a la vista). */
  arrancar: () => void
  /** Apaga el reloj (llamalo al salir de la vista). */
  parar: () => void
  /** Enciende/apaga el automático y lo recuerda. */
  alternar: () => void
}

/**
 * Refresca periódicamente mientras la vista esté visible.
 * @param cargar - Función que trae los datos (debe ser idempotente y silenciosa).
 * @param opciones - `intervaloMs` (default 60 s) y `clave` de localStorage para recordar si está activo.
 * @returns Estado y controles del refresco.
 */
export function useAutoRefresh(
  cargar: () => Promise<void>,
  opciones: { intervaloMs?: number; clave?: string } = {},
): AutoRefresh {
  const intervaloMs = opciones.intervaloMs ?? 60_000
  const clave = opciones.clave ?? 'autoRefresh'

  const activo = ref(localStorage.getItem(clave) !== 'off')
  const ultima = ref<Date | null>(null)
  const fallos = ref(0)
  const ahora = ref(Date.now())

  let timer: ReturnType<typeof setInterval> | null = null
  let corriendo = false
  let ultimoIntento = 0

  const hace = computed(() => {
    if (!ultima.value) return 'sin datos'
    const seg = Math.max(0, Math.round((ahora.value - ultima.value.getTime()) / 1000))
    if (seg < 15) return 'recién'
    if (seg < 60) return `hace ${seg} s`
    const min = Math.round(seg / 60)
    if (min < 60) return `hace ${min} min`
    return `hace ${Math.round(min / 60)} h`
  })

  async function ejecutar(): Promise<void> {
    if (corriendo) return          // el pedido anterior sigue en vuelo: se saltea el turno
    corriendo = true
    ultimoIntento = Date.now()
    try {
      await cargar()
      ultima.value = new Date()
      fallos.value = 0
    } catch {
      fallos.value++               // se cuenta, no se muestra: ver el comentario de arriba
    } finally {
      corriendo = false
      ahora.value = Date.now()
    }
  }

  function tick(): void {
    ahora.value = Date.now()
    if (!activo.value || document.hidden) return
    if (Date.now() - ultimoIntento >= intervaloMs) void ejecutar()
  }

  /** Al volver a la pestaña, lo que está en pantalla ya es viejo: se refresca sin esperar. */
  function onVisibilidad(): void {
    if (!document.hidden && activo.value) void ejecutar()
  }

  function arrancar(): void {
    if (timer) return
    timer = setInterval(tick, TICK_MS)
    document.addEventListener('visibilitychange', onVisibilidad)
  }

  function parar(): void {
    if (timer) { clearInterval(timer); timer = null }
    document.removeEventListener('visibilitychange', onVisibilidad)
  }

  function alternar(): void {
    activo.value = !activo.value
    localStorage.setItem(clave, activo.value ? 'on' : 'off')
    if (activo.value) void ejecutar()
  }

  /**
   * Refresco manual: además de traer los datos, reinicia la cuenta del intervalo (lo hace
   * `ejecutar`) para que el automático no dispare otro pedido un segundo después.
   */
  async function refrescarAhora(): Promise<void> {
    await ejecutar()
  }

  /**
   * La vista trajo los datos por su cuenta (la carga inicial, la que muestra el skeleton).
   * Sin esto el reloj creería que nunca se actualizó y pediría de nuevo en el primer tick.
   */
  function marcarCargado(): void {
    ultima.value = new Date()
    ultimoIntento = Date.now()
    fallos.value = 0
    ahora.value = Date.now()
  }

  onUnmounted(parar)

  return { activo, ultima, hace, fallos, refrescarAhora, marcarCargado, arrancar, parar, alternar }
}
