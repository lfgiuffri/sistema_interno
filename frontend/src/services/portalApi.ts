/**
 * Cliente HTTP del PORTAL DE CLIENTES.
 *
 * Instancia propia y no el `api` del sistema interno, por tres cosas que están cableadas allá
 * y que acá harían daño:
 *  - Lee `accessToken` de localStorage. Si el portal usara la misma clave, las dos sesiones se
 *    pisarían en el mismo navegador.
 *  - Ante un refresh fallido hace `useAuthStore().logout()` y `window.location.href = '/login'`,
 *    que es el login del sistema interno: un cliente terminaría en una pantalla que no es suya.
 *  - Reconecta el socket, que el portal no usa a propósito (la room `app` recibe los
 *    broadcasts de TODOS los clientes).
 *
 * Lo único que se reusa es `apiErrorMessage`, que es una función pura.
 */
import axios from 'axios'
import { apiErrorMessage } from './api'

export { apiErrorMessage }

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3010/api'

/** Claves propias: la sesión del portal y la del sistema interno conviven sin pisarse. */
export const PORTAL_ACCESS_KEY = 'portalAccessToken'
export const PORTAL_REFRESH_KEY = 'portalRefreshToken'

const portalApi = axios.create({ baseURL: API_BASE, timeout: 30000 })

portalApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(PORTAL_ACCESS_KEY)
  if (token) config.headers['x-access-token'] = token
  return config
})

let refrescando: Promise<string | null> | null = null

/**
 * Renueva el access token. Una sola llamada en vuelo a la vez: si dos requests fallan juntos,
 * el segundo espera al primero en vez de disparar otro refresh.
 * @returns El token nuevo, o null si la sesión murió.
 */
async function refrescar(): Promise<string | null> {
  if (refrescando) return refrescando
  refrescando = (async () => {
    const refreshToken = localStorage.getItem(PORTAL_REFRESH_KEY)
    if (!refreshToken) return null
    try {
      const { data } = await axios.post(`${API_BASE}/portal/auth/refresh`, null, {
        headers: { 'x-refresh-token': refreshToken },
      })
      if (!data?.success) return null
      localStorage.setItem(PORTAL_ACCESS_KEY, data.data.accessToken)
      localStorage.setItem(PORTAL_REFRESH_KEY, data.data.refreshToken)
      return data.data.accessToken as string
    } catch {
      return null
    } finally {
      refrescando = null
    }
  })()
  return refrescando
}

portalApi.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    const esExpirado = error.response?.status === 401
      && error.response?.data?.errorCode === 'TOKEN_EXPIRED'
      && !original?._retry

    if (esExpirado) {
      original._retry = true
      const token = await refrescar()
      if (token) {
        original.headers['x-access-token'] = token
        return portalApi(original)
      }
    }

    // Sesión muerta: se limpia y se vuelve al login DEL PORTAL, no al interno.
    if (error.response?.status === 401 || error.response?.status === 403) {
      if (original?._retry || error.response?.status === 403) {
        localStorage.removeItem(PORTAL_ACCESS_KEY)
        localStorage.removeItem(PORTAL_REFRESH_KEY)
        if (!window.location.pathname.startsWith('/portal/login')) {
          window.location.href = '/portal/login'
        }
      }
    }
    return Promise.reject(error)
  },
)

export default portalApi
