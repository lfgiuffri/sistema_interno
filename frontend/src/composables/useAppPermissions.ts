import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { useToast } from '@/composables/useToast'
import { usePushNotifications } from '@/composables/useNative'

/**
 * Orquesta los permisos del SO post-login: notificaciones, geolocalización (foreground) y micrófono.
 * El permiso del micrófono no se puede pedir proactivamente desde JS sin un plugin dedicado;
 * lo gatilla MainActivity cuando el usuario apreta el botón de mic por primera vez.
 *
 * Para los demás permisos:
 *  - Push: PushNotifications.requestPermissions()
 *  - Geolocation: Geolocation.requestPermissions()
 *  - Web Notification: Notification.requestPermission()
 */
export function useAppPermissions() {
  const toast = useToast()
  const { register: registerPush } = usePushNotifications()

  async function requestPushPermission(): Promise<boolean> {
    try {
      if (Capacitor.isNativePlatform()) {
        await registerPush()
        return true
      }
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') return true
        if (Notification.permission === 'denied') return false
        const result = await Notification.requestPermission()
        return result === 'granted'
      }
      return false
    } catch (err) {
      console.warn('[permissions] push:', err)
      return false
    }
  }

  async function requestGeolocationPermission(): Promise<boolean> {
    try {
      if (Capacitor.isNativePlatform()) {
        const status = await Geolocation.checkPermissions()
        if (status.location === 'granted' || status.coarseLocation === 'granted') return true
        const result = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] })
        return result.location === 'granted' || result.coarseLocation === 'granted'
      }
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return false
      // En web pedirlo gatilla el prompt del browser
      return new Promise<boolean>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(false),
          { timeout: 15000, maximumAge: 60_000 }
        )
      })
    } catch (err) {
      console.warn('[permissions] geolocation:', err)
      return false
    }
  }

  /**
   * Pide micrófono on-demand. En web triggea el prompt del browser; en APK Android
   * el prompt del SO lo gatilla MainActivity cuando el WebView llama getUserMedia.
   * Si está denegado y el browser ya rechazó, mostramos toast.
   */
  async function ensureMicrophonePermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Cerramos enseguida — solo era para chequear permission
      stream.getTracks().forEach(t => t.stop())
      return true
    } catch (err: any) {
      const name = err?.name || ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        toast.warning('Activá el permiso de micrófono en los ajustes del sistema para usar mensajes de voz.')
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        toast.error('No se detectó un micrófono en este dispositivo.')
      } else {
        toast.error('No pude acceder al micrófono.')
      }
      return false
    }
  }

  /**
   * Pide todos los permisos clave secuencialmente al iniciar sesión.
   * No bloqueante: corre fire-and-forget. El usuario puede rechazar y la app sigue funcionando.
   */
  async function requestAllOnLogin(): Promise<void> {
    // Push primero (lo más importante para retención)
    await requestPushPermission()
    // Geolocation segundo (para reminders de ubicación)
    await requestGeolocationPermission()
    // Mic NO se pide acá: se pide on-demand cuando el usuario apreta el botón de voz.
  }

  return {
    requestAllOnLogin,
    requestPushPermission,
    requestGeolocationPermission,
    ensureMicrophonePermission
  }
}
