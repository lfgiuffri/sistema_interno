/**
 * Notificaciones del navegador (Web Push) para Chrome, Edge y Firefox.
 *
 * Es un camino distinto del de la app nativa: `@capacitor/push-notifications` usa Firebase y
 * solo funciona dentro del APK. En una pestaña no hace nada, y por eso el botón «Probar»
 * fallaba: nunca había un destino registrado.
 *
 * Cómo funciona: el navegador da un «endpoint» propio por dispositivo; el servidor le manda
 * ahí el mensaje cifrado, firmado con las claves VAPID. No interviene ningún tercero.
 *
 * Requisitos que impone el navegador y no se pueden esquivar:
 *  - **HTTPS** (o localhost). En producción ya está.
 *  - **Service worker registrado** — lo pone la PWA.
 *  - **Permiso explícito** del usuario, y solo se puede pedir desde un gesto suyo (un click).
 *    Si lo deniega, la app NO puede volver a preguntar: hay que cambiarlo desde el candado
 *    de la barra de direcciones.
 */
import { ref } from 'vue'
import api from '@/services/api'

export type EstadoNotificaciones = 'no-soportado' | 'sin-permiso' | 'bloqueado' | 'activas'

const estado = ref<EstadoNotificaciones>('sin-permiso')
const ocupado = ref(false)

/** ¿El navegador tiene todo lo necesario? */
const soportado = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/**
 * Mira en qué situación está este navegador, sin pedir nada.
 * @returns El estado detectado.
 */
export async function revisarEstado(): Promise<EstadoNotificaciones> {
  if (!soportado()) { estado.value = 'no-soportado'; return estado.value }
  if (Notification.permission === 'denied') { estado.value = 'bloqueado'; return estado.value }
  if (Notification.permission !== 'granted') { estado.value = 'sin-permiso'; return estado.value }

  // Con permiso concedido todavía puede faltar la suscripción (otro navegador, datos
  // borrados): activas = permiso Y suscripción viva.
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  estado.value = sub ? 'activas' : 'sin-permiso'
  return estado.value
}

/**
 * La clave pública viene en base64url y `subscribe()` la pide como bytes.
 * Se devuelve el ArrayBuffer y no el Uint8Array: el tipo de `applicationServerKey` exige un
 * buffer respaldado por ArrayBuffer, y un Uint8Array genérico no lo satisface.
 */
function base64UrlABytes(base64: string): ArrayBuffer {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4)
  const normal = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/')
  const crudo = atob(normal)
  const bytes = new Uint8Array(crudo.length)
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i)
  return bytes.buffer
}

export function useNotificacionesNavegador() {
  /**
   * Pide permiso, se suscribe y registra el dispositivo en el servidor.
   * @returns Mensaje de resultado para mostrarle al usuario.
   */
  async function activar(): Promise<{ ok: boolean; mensaje: string }> {
    if (!soportado()) return { ok: false, mensaje: 'Este navegador no soporta notificaciones.' }

    ocupado.value = true
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        estado.value = permiso === 'denied' ? 'bloqueado' : 'sin-permiso'
        return {
          ok: false,
          mensaje: permiso === 'denied'
            ? 'Bloqueaste las notificaciones. Para permitirlas, tocá el candado en la barra de direcciones.'
            : 'No se concedió el permiso.',
        }
      }

      const { data } = await api.get('/settings/push/clave-publica')
      const clave = data?.data?.clavePublica
      if (!clave) return { ok: false, mensaje: 'El servidor no tiene configuradas las notificaciones del navegador.' }

      const reg = await navigator.serviceWorker.ready
      // `userVisibleOnly: true` es obligatorio en Chrome: se compromete a que todo push
      // muestre una notificación visible (nada de push silenciosos).
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlABytes(clave),
      })

      await api.post('/settings/push/suscripcion', sub.toJSON())
      estado.value = 'activas'
      return { ok: true, mensaje: 'Notificaciones activadas en este navegador' }
    } catch (e) {
      return { ok: false, mensaje: `No se pudieron activar: ${(e as Error).message}` }
    } finally {
      ocupado.value = false
    }
  }

  /**
   * Cancela la suscripción de ESTE navegador (los demás siguen recibiendo).
   * @returns Mensaje de resultado.
   */
  async function desactivar(): Promise<{ ok: boolean; mensaje: string }> {
    ocupado.value = true
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        // Primero el servidor: si se cancela local y falla el borrado remoto, quedaría una
        // suscripción muerta a la que se le sigue enviando.
        await api.delete('/settings/push/suscripcion', { data: { endpoint: sub.endpoint } }).catch(() => null)
        await sub.unsubscribe()
      }
      estado.value = 'sin-permiso'
      return { ok: true, mensaje: 'Notificaciones desactivadas en este navegador' }
    } finally {
      ocupado.value = false
    }
  }

  return { estado, ocupado, revisarEstado, activar, desactivar }
}
