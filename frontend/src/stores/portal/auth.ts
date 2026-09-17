/**
 * Sesión del PORTAL DE CLIENTES.
 *
 * Misma forma que `stores/auth.ts` pero sin socket, sin MFA y —clave— **sin
 * `resetAllStores()`**: ese reset es del sistema interno y limpia sus 13 stores. Si el portal
 * lo llamara, cerrar sesión en el portal borraría el estado del sistema interno del mismo
 * navegador, y viceversa.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import portalApi, { apiErrorMessage, PORTAL_ACCESS_KEY, PORTAL_REFRESH_KEY } from '@/services/portalApi'

export interface UsuarioPortal {
  id: number
  nombre: string
  email: string
  cliente: { id: number; nombre: string }
}

export const usePortalAuthStore = defineStore('portalAuth', () => {
  const usuario = ref<UsuarioPortal | null>(null)
  const autenticado = ref(!!localStorage.getItem(PORTAL_ACCESS_KEY))
  const cargando = ref(false)
  const error = ref('')

  /**
   * Entra al portal.
   * @param email - Email del usuario de portal.
   * @param password - Contraseña.
   * @returns true si entró.
   */
  async function login(email: string, password: string): Promise<boolean> {
    cargando.value = true
    error.value = ''
    try {
      const { data } = await portalApi.post('/portal/auth/signin', { email, password })
      if (!data.success) { error.value = data.message; return false }
      localStorage.setItem(PORTAL_ACCESS_KEY, data.data.accessToken)
      localStorage.setItem(PORTAL_REFRESH_KEY, data.data.refreshToken)
      usuario.value = data.data.usuario
      autenticado.value = true
      return true
    } catch (e) {
      error.value = apiErrorMessage(e)
      return false
    } finally {
      cargando.value = false
    }
  }

  /**
   * Trae el contexto del usuario logueado. Es también la forma de saber si el token sigue
   * valiendo al recargar la página.
   * @returns true si la sesión está viva.
   */
  async function cargarContexto(): Promise<boolean> {
    if (!localStorage.getItem(PORTAL_ACCESS_KEY)) return false
    try {
      const { data } = await portalApi.get('/portal/me')
      if (!data.success) return false
      usuario.value = data.data
      autenticado.value = true
      return true
    } catch {
      autenticado.value = false
      return false
    }
  }

  /** Cierra la sesión del portal (y SOLO la del portal). */
  function logout(): void {
    localStorage.removeItem(PORTAL_ACCESS_KEY)
    localStorage.removeItem(PORTAL_REFRESH_KEY)
    usuario.value = null
    autenticado.value = false
  }

  return { usuario, autenticado, cargando, error, login, cargarContexto, logout }
})
