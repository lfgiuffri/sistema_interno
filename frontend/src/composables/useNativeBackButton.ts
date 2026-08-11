import { useBackButton } from '@ionic/vue'
import { Capacitor } from '@capacitor/core'
import type { Router } from 'vue-router'

/**
 * Maneja el botón de "atrás" hardware (Android).
 *
 * Reglas:
 * - super_admin (master):
 *    - En `/admin` (lista de tenants, primer menú) → minimiza la app.
 *    - En cualquier subruta de `/admin/*` → vuelve a `/admin`.
 * - Tenant normal:
 *    - En `/dashboard/home` → minimiza la app.
 *    - En cualquier otra ruta autenticada (settings, items, etc.) → vuelve a `/dashboard/home`.
 * - En `/login` o sin sesión → minimiza.
 *
 * iOS no dispara back-button hardware; el swipe-back nativo de Ionic se mantiene.
 *
 * Prioridad 100 para anular el handler default de Ionic Router (priority 0).
 */
export function setupNativeBackButton(router: Router) {
  useBackButton(100, async () => {
    if (!Capacitor.isNativePlatform()) return

    const path = router.currentRoute.value.path
    const role = localStorage.getItem('userRole')
    const token = localStorage.getItem('accessToken')

    const minimize = async () => {
      try {
        const { App } = await import('@capacitor/app')
        await App.minimizeApp()
      } catch (_err) {
        // iOS u otros entornos sin soporte → silencioso.
      }
    }

    if (!token || path === '/login') {
      await minimize()
      return
    }

    if (role === 'super_admin') {
      if (path === '/admin' || path === '/admin/') {
        await minimize()
      } else {
        router.replace('/admin')
      }
      return
    }

    if (path === '/dashboard/home' || path === '/dashboard/home/') {
      await minimize()
    } else {
      router.replace('/dashboard/home')
    }
  })
}
