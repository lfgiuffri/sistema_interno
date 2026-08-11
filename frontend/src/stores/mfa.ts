/**
 * Store de gestión del segundo factor (TOTP) para el usuario logueado.
 *
 * Cubre el alta (`enroll` → `activate`) y la baja (`disable`) del 2FA. El login
 * con MFA ya vive en `stores/auth.ts`; este store solo administra el factor.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'
import type { MfaEnrollment } from '@/types'

export const useMfaStore = defineStore('mfa', () => {
  const enrollment = ref<MfaEnrollment | null>(null)
  // Estado real del 2FA del usuario. `null` = todavía no consultado (mostrar carga).
  const mfaEnabled = ref<boolean | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Consulta si el usuario logueado tiene el 2FA activo. La UI de Seguridad lo usa
   * para mostrar una sola acción (activar o desactivar) según el estado real.
   * @returns true/false según el estado; null si la consulta falló.
   */
  async function fetchStatus(): Promise<boolean | null> {
    error.value = null
    try {
      const { data } = await api.get('/auth/mfa/status')
      if (data.success) {
        mfaEnabled.value = !!data.data.mfaEnabled
        return mfaEnabled.value
      }
      return null
    } catch (e) {
      error.value = apiErrorMessage(e)
      return null
    }
  }

  /**
   * Inicia el enrolamiento de 2FA: el backend genera un secreto TOTP y códigos
   * de respaldo. Todavía no queda activo hasta confirmar con `activate`.
   * @returns Los datos del enrolamiento, o null si falló (motivo en `error`).
   */
  async function enroll(): Promise<MfaEnrollment | null> {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post('/auth/mfa/enroll')
      if (data.success) {
        enrollment.value = data.data as MfaEnrollment
        return enrollment.value
      }
      return null
    } catch (e) {
      error.value = apiErrorMessage(e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * Activa el 2FA confirmando un código TOTP del autenticador.
   * @param code - Código de 6 dígitos.
   * @returns true si el 2FA quedó activo (si no, el motivo queda en `error`).
   */
  async function activate(code: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post('/auth/mfa/activate', { code })
      if (data.success) {
        enrollment.value = null
        mfaEnabled.value = true
        return true
      }
      return false
    } catch (e) {
      error.value = apiErrorMessage(e)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Desactiva el 2FA. Requiere reingresar la contraseña como confirmación.
   * @param password - Contraseña actual del usuario.
   * @returns true si el 2FA quedó deshabilitado (si no, el motivo queda en `error`).
   */
  async function disable(password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post('/auth/mfa/disable', { password })
      if (data.success) mfaEnabled.value = false
      return !!data.success
    } catch (e) {
      error.value = apiErrorMessage(e)
      return false
    } finally {
      loading.value = false
    }
  }

  /** Descarta el enrolamiento en curso (al cerrar el flujo sin activar) y limpia el error. */
  function reset(): void {
    enrollment.value = null
    mfaEnabled.value = null
    error.value = null
  }

  return { enrollment, mfaEnabled, loading, error, fetchStatus, enroll, activate, disable, reset }
})
