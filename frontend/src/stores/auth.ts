/**
 * Store de autenticación (single-tenant).
 *
 * Responsable de: login con password, segundo factor (MFA/TOTP), restauración de
 * sesión al boot y logout. No conoce de módulos ni de UI — eso vive en
 * `stores/me.ts` y las views.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api, { apiErrorMessage } from '@/services/api'
import { connectSocket, disconnectSocket } from '@/services/socket'
import { resetAllStores } from '@/stores/reset'
import type { SessionData } from '@/types'

/** Resultado de un intento de login, consumido por la LoginPage para rutear. */
export type LoginResult =
  | { status: 'ok' }
  | { status: 'mfa'; mfaToken: string }
  | { status: 'error'; message: string }

export const useAuthStore = defineStore('auth', () => {
  const loading = ref(false)
  /** Último mensaje de error de auth (tomado del backend) para mostrar en la UI. */
  const error = ref('')
  // Flag de inicialización: el store es la única fuente de verdad de la sesión; el router
  // delega en ensureInitialized() en vez de llevar su propio flag y leer localStorage.
  const initialized = ref(false)
  // Estado reactivo de sesión. localStorage NO es reactivo: este ref se sincroniza en
  // persistSession/init/logout y es la fuente de verdad reactiva; el token sigue en
  // localStorage para el interceptor y el reload.
  const authenticated = ref(!!localStorage.getItem('accessToken'))

  const isAuthenticated = computed(() => authenticated.value)

  /**
   * Persiste los tokens de una sesión recién emitida y conecta el socket.
   * @param data - Datos de sesión devueltos por signin o mfa/login.
   */
  function finalizeSession(data: SessionData): void {
    // Sin accessToken NO hay sesión real (evita un "autenticado" fantasma).
    if (!data.accessToken) {
      throw new Error('Sesión inválida: el backend no devolvió accessToken')
    }
    localStorage.setItem('accessToken', data.accessToken)
    if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken)
    authenticated.value = true
    try { connectSocket() } catch { /* socket opcional */ }
  }

  /**
   * Login con usuario y contraseña.
   * @param username - Usuario o email.
   * @param password - Contraseña en texto plano (viaja sobre HTTPS).
   * @returns Resultado tipado para que la view decida el siguiente paso.
   */
  async function login(username: string, password: string): Promise<LoginResult> {
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.post('/auth/signin', { username, password })
      if (!data.success) {
        error.value = data.message || 'Credenciales inválidas'
        return { status: 'error', message: error.value }
      }
      const session: SessionData = data.data
      // El backend puede pedir un segundo factor antes de emitir tokens.
      if (session.mfaRequired && session.mfaToken) {
        return { status: 'mfa', mfaToken: session.mfaToken }
      }
      finalizeSession(session)
      return { status: 'ok' }
    } catch (e) {
      error.value = apiErrorMessage(e)
      return { status: 'error', message: error.value }
    } finally {
      loading.value = false
    }
  }

  /**
   * Completa un login que requería MFA enviando el código TOTP (o un backup code).
   * @param mfaToken - Token temporal recibido en el primer paso del login.
   * @param code - Código de 6 dígitos del autenticador o backup code.
   * @returns true si la sesión quedó emitida.
   */
  async function verifyMfa(mfaToken: string, code: string): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.post('/auth/mfa/login', { mfaToken, code })
      if (!data.success) {
        error.value = data.message || 'Código inválido'
        return false
      }
      finalizeSession(data.data)
      return true
    } catch (e) {
      error.value = apiErrorMessage(e)
      return false
    } finally {
      loading.value = false
    }
  }

  /** Restaura la sesión al arrancar la app (los tokens viven en localStorage). */
  function init(): void {
    const token = localStorage.getItem('accessToken')
    if (!token) return
    authenticated.value = true
    try { connectSocket() } catch { /* socket opcional */ }
  }

  /**
   * Restaura la sesión una sola vez (idempotente). Lo llama el guard del router en cada
   * navegación; solo corre init() la primera vez.
   */
  function ensureInitialized(): void {
    if (initialized.value) return
    initialized.value = true
    init()
  }

  /**
   * Cierra la sesión: limpia tokens, socket y TODOS los feature stores.
   * El reset de stores vive acá para que ninguna pantalla que cierre sesión
   * pueda olvidarse de limpiar y filtrar datos al próximo usuario.
   */
  function logout(): void {
    authenticated.value = false
    initialized.value = false
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    disconnectSocket()
    resetAllStores()
  }

  return {
    loading,
    error,
    isAuthenticated,
    login,
    verifyMfa,
    finalizeSession,
    init,
    ensureInitialized,
    logout,
  }
})
