import { toastController } from '@ionic/vue'
import {
  checkmarkCircleOutline,
  alertCircleOutline,
  warningOutline,
  informationCircleOutline,
} from 'ionicons/icons'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastOptions {
  duration?: number
  position?: 'top' | 'bottom' | 'middle'
}

const ICON_BY_TYPE: Record<ToastType, string> = {
  success: checkmarkCircleOutline,
  error: alertCircleOutline,
  warning: warningOutline,
  info: informationCircleOutline,
}

const CSS_BY_TYPE: Record<ToastType, string> = {
  success: 'ls-toast ls-toast-success',
  error: 'ls-toast ls-toast-error',
  warning: 'ls-toast ls-toast-warning',
  info: 'ls-toast ls-toast-info',
}

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 2400,
  error: 3800,
  warning: 3200,
  info: 2600,
}

async function show(type: ToastType, message: string, opts: ToastOptions = {}) {
  // En mobile la convención es bottom (por encima del keyboard / safe-area-bottom).
  // En desktop (web) también va abajo — más cerca del cursor y menos invasivo.
  const t = await toastController.create({
    message,
    duration: opts.duration ?? DEFAULT_DURATION[type],
    position: opts.position ?? 'bottom',
    positionAnchor: undefined,
    cssClass: CSS_BY_TYPE[type],
    icon: ICON_BY_TYPE[type],
    swipeGesture: 'vertical',
    layout: 'baseline',
  })
  await t.present()
  return t
}

/**
 * Helper unificado de toasts (web + APK).
 * Usar en lugar de `toastController.create()` directo.
 *
 * Estilos definidos en theme/global.css (clases `.ls-toast-*`).
 */
export function useToast() {
  return {
    success: (message: string, opts?: ToastOptions) => show('success', message, opts),
    error: (message: string, opts?: ToastOptions) => show('error', message, opts),
    warning: (message: string, opts?: ToastOptions) => show('warning', message, opts),
    info: (message: string, opts?: ToastOptions) => show('info', message, opts),
  }
}
