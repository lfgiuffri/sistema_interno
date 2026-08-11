import axios from 'axios'
import { reconnectSocket } from './socket'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3010/api'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

/**
 * Extrae un mensaje de error legible de un error de Axios, priorizando el envelope de
 * responseManager del backend (`{ message, errorCode }`). Permite que los stores expongan
 * contexto de error en `error.value` en vez de tragárselo en un `null`/`false` anónimo.
 * @param e - Error capturado (típicamente AxiosError).
 * @returns Mensaje legible para mostrar al usuario.
 */
export const apiErrorMessage = (e: unknown): string => {
  const err = e as { response?: { data?: { message?: string } }; message?: string }
  return err?.response?.data?.message || err?.message || 'Error de red'
}

const TOKEN_REFRESH_MARGIN_SECONDS = 60

const parseJwtPayload = (token: string): { exp?: number } | null => {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

const shouldRefreshToken = (token: string) => {
  const exp = parseJwtPayload(token)?.exp
  if (!exp) return false
  return exp <= Math.floor(Date.now() / 1000) + TOKEN_REFRESH_MARGIN_SECONDS
}

// Interceptor: agregar tokens a cada request
api.interceptors.request.use(async (config) => {
  let token = localStorage.getItem('accessToken')
  const isAuthRoute = String(config.url || '').startsWith('/auth')
  if (token && !isAuthRoute && shouldRefreshToken(token)) {
    token = await refreshAccessToken()
  }
  if (token) {
    config.headers['x-access-token'] = token
  }
  return config
})

// Cola de requests pendientes mientras se refresca el token
let isRefreshing = false
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = []

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (token) {
      resolve(token)
    } else {
      reject(error)
    }
  })
  failedQueue = []
}

const refreshAccessToken = async () => {
  if (isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      failedQueue.push({ resolve, reject })
    })
  }

  isRefreshing = true
  try {
    const refreshToken = localStorage.getItem('refreshToken')
    if (!refreshToken) throw new Error('No refresh token')

    const { data } = await axios.post(`${API_BASE}/auth/refresh`, null, {
      headers: { 'x-refresh-token': refreshToken }
    })

    if (!data.success) throw new Error(data.message || 'Refresh failed')

    const newAccessToken = data.data.accessToken
    localStorage.setItem('accessToken', newAccessToken)
    localStorage.setItem('refreshToken', data.data.refreshToken)
    processQueue(null, newAccessToken)
    reconnectSocket()
    return newAccessToken
  } catch (refreshError) {
    processQueue(refreshError, null)
    // Delegamos la limpieza de sesión en el auth store (única fuente de verdad): limpia tokens,
    // resetea feature stores y desconecta el socket. Antes se limpiaba a mano acá y se OLVIDABA
    // disconnectSocket() + el reset de stores, dejando el socket vivo y datos del usuario saliente.
    // Import dinámico para evitar el ciclo api ↔ auth (el store importa este módulo).
    const { useAuthStore } = await import('@/stores/auth')
    useAuthStore().logout()
    window.location.href = '/login'
    throw refreshError
  } finally {
    isRefreshing = false
  }
}

// Interceptor: manejar token expirado con auto-refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Solo intentar refresh si es 401 con TOKEN_EXPIRED y no es un retry
    if (
      error.response?.status === 401 &&
      error.response?.data?.errorCode === 'TOKEN_EXPIRED' &&
      !originalRequest._retry
    ) {
      // Si ya hay un refresh en curso, encolar este request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers['x-access-token'] = token
              resolve(api(originalRequest))
            },
            reject
          })
        })
      }

      originalRequest._retry = true

      try {
        const newAccessToken = await refreshAccessToken()
        originalRequest.headers['x-access-token'] = newAccessToken
        return api(originalRequest)
      } catch (refreshError) {
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

export default api
