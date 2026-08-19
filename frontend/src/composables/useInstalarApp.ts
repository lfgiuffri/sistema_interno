/**
 * Instalación de la PWA desde la app, sin depender del cartel del navegador.
 *
 * El navegador ofrece instalar UNA vez y, si lo cerrás, no vuelve a insistir — que es
 * exactamente lo que pasó acá. La única forma de volver a ofrecerlo es guardar el evento
 * `beforeinstallprompt` y dispararlo nosotros cuando el usuario lo pida.
 *
 * Dos cosas obligan a que esto viva en un singleton de módulo y no dentro de un componente:
 *  1. El evento se dispara UNA sola vez y muy temprano (antes de que exista la pantalla de
 *     Configuración). Si nadie lo escucha en ese momento, se pierde para siempre.
 *  2. Hay que llamar a `preventDefault()` para quedarnos con él; si no, el navegador muestra
 *     su propia barrita y descarta el evento.
 *
 * Por eso `iniciarInstalacion()` se llama en `main.ts`, al arrancar.
 */
import { ref, computed, readonly } from 'vue'

/** El evento no está tipado en el DOM estándar (es propuesta de Chromium). */
interface EventoInstalacion extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** El evento guardado, a la espera de que el usuario pida instalar. */
const pendiente = ref<EventoInstalacion | null>(null)
const instalada = ref(false)

/** ¿Está corriendo como app instalada y no como pestaña del navegador? */
const detectarInstalada = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches === true
  // iOS marca las apps agregadas a la pantalla de inicio con esta propiedad propia.
  || (window.navigator as unknown as { standalone?: boolean }).standalone === true

/**
 * Engancha los listeners. Llamar UNA vez al arrancar la app, antes de que el navegador
 * dispare el evento.
 */
export function iniciarInstalacion(): void {
  instalada.value = detectarInstalada()

  window.addEventListener('beforeinstallprompt', (e) => {
    // Sin esto el navegador muestra su cartel y se queda con el evento.
    e.preventDefault()
    pendiente.value = e as EventoInstalacion
  })

  window.addEventListener('appinstalled', () => {
    instalada.value = true
    pendiente.value = null
  })
}

/** iOS/iPadOS Safari nunca dispara `beforeinstallprompt`: ahí se instala a mano. */
const esIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent)
  // iPadOS moderno se hace pasar por Mac; se lo reconoce porque tiene pantalla táctil.
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function useInstalarApp() {
  /**
   * Pide instalar. Devuelve qué eligió el usuario.
   * @returns 'instalada' | 'rechazada' | 'no-disponible'
   */
  async function instalar(): Promise<'instalada' | 'rechazada' | 'no-disponible'> {
    const evento = pendiente.value
    if (!evento) return 'no-disponible'
    await evento.prompt()
    const { outcome } = await evento.userChoice
    // El evento se consume: no se puede volver a usar el mismo.
    pendiente.value = null
    if (outcome === 'accepted') { instalada.value = true; return 'instalada' }
    return 'rechazada'
  }

  return {
    /** Ya corre como app instalada. */
    instalada: readonly(instalada),
    /** Se puede disparar el diálogo del navegador ahora mismo. */
    sePuedeInstalar: computed(() => !instalada.value && pendiente.value !== null),
    /** Hay que explicar cómo hacerlo a mano (iOS, o el navegador no ofreció el diálogo). */
    requiereInstruccionesManuales: computed(() => !instalada.value && pendiente.value === null),
    esIOS: esIOS(),
    instalar,
  }
}
