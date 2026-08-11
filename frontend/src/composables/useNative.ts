/**
 * Helpers de plataforma nativa (Capacitor): push notifications y geolocalización.
 *
 * Los plugins se importan dinámicamente y todo va envuelto en try/catch para que
 * la app web/desktop siga funcionando aunque el plugin no esté disponible.
 */
import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import api from '@/services/api'

const isNative = Capacitor.isNativePlatform()

/**
 * Registra el listener de acciones de notificaciones locales al boot.
 * El shell genérico solo lo loguea; cada app define qué hacer con la acción.
 * @returns Promesa que resuelve cuando el listener quedó registrado.
 */
export async function setupLocalNotificationActions(): Promise<void> {
  if (!isNative) return
  if ((window as any).__sistemaLocalNotifListener) return
  ;(window as any).__sistemaLocalNotifListener = true
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      // Punto de extensión: rutear la acción según `event.notification.extra`.
      console.log('[notif] action performed:', event.actionId)
    })
  } catch (err) {
    console.warn('[notif] setupLocalNotificationActions failed:', err)
  }
}

/** Notificaciones push (FCM en native). Defensivo ante falta de Firebase. */
export function usePushNotifications() {
  const permissionGranted = ref(false)

  /**
   * Pide permiso de push y registra el token contra el backend.
   * No-op en web. Envuelto en try/catch porque `register()` crashea si falta
   * `google-services.json` en el APK.
   * @returns Promesa que resuelve cuando el registro terminó (o se omitió).
   */
  async function register(): Promise<void> {
    if (!isNative) return
    if ((window as any).__sistemaPushSetup) return
    ;(window as any).__sistemaPushSetup = true

    try {
      const { PushNotifications } = await import('@capacitor/push-notifications')

      let perm
      try {
        perm = await PushNotifications.requestPermissions()
      } catch (err) {
        console.warn('[push] requestPermissions failed:', err)
        return
      }
      if (perm.receive !== 'granted') return
      permissionGranted.value = true

      // Listeners ANTES del register() para no perder el primer evento.
      PushNotifications.addListener('registration', async (token) => {
        try {
          await api.put('/settings', { pushToken: token.value, pushEnabled: true })
        } catch (e) {
          console.error('Failed to save push token', e)
        }
      })

      PushNotifications.addListener('registrationError', (err) => {
        console.error('Push registration error:', err)
      })

      try {
        await PushNotifications.register()
      } catch (err) {
        // Típicamente "Default FirebaseApp is not initialized" si falta config.
        console.warn('[push] register() failed (Firebase no configurado?):', err)
      }
    } catch (err) {
      console.warn('[push] init failed:', err)
    }
  }

  return { register, permissionGranted }
}

/** Geolocalización (native vía Capacitor, web vía navigator). */
export function useGeolocation() {
  const currentPosition = ref<{ latitude: number; longitude: number } | null>(null)

  /**
   * Obtiene la posición actual del dispositivo.
   * @returns Coordenadas, o null si se denegó el permiso o falló.
   */
  async function getCurrentPosition(): Promise<{ latitude: number; longitude: number } | null> {
    try {
      if (isNative) {
        const { Geolocation } = await import('@capacitor/geolocation')
        const perm = await Geolocation.requestPermissions()
        if (perm.location !== 'granted') return null
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true })
        currentPosition.value = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
      } else {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true }),
        )
        currentPosition.value = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
      }
      return currentPosition.value
    } catch {
      return null
    }
  }

  return { getCurrentPosition, currentPosition }
}
