import { io, Socket } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3010'

let socket: Socket | null = null

export function connectSocket(): Socket {
  if (socket?.connected) return socket

  const token = localStorage.getItem('accessToken')
  if (!token) throw new Error('No access token for socket')

  // Si ya existe un socket desconectado, limpiar antes de reconectar
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  })

  socket.on('connect', () => {
    console.log('Socket connected')
    // Notificamos a quien quiera refetchar tras una reconexión.
    try {
      window.dispatchEvent(new CustomEvent('sistema:socket-connected'))
    } catch { /* ignore */ }
  })

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason)
  })

  socket.on('connect_error', (err) => {
    console.warn('Socket connection error:', err.message)
  })

  // Reconectar con token renovado cuando el server indica expiración
  socket.on('auth:expired', () => {
    console.log('Token expirado, reconectando con token renovado...')
    reconnectSocket()
  })

  return socket
}

/**
 * Reconecta el socket con el token actual de localStorage.
 */
export function reconnectSocket() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
  const token = localStorage.getItem('accessToken')
  if (token) {
    connectSocket()
  }
}

export function getSocket(): Socket | null {
  return socket
}

/**
 * Espera a que el socket esté conectado, hasta `timeoutMs` ms.
 * Resuelve true si ya está / pudo conectarse a tiempo, false si no.
 */
export function waitForSocketConnection(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = socket
    if (!s) return resolve(false)
    if (s.connected) return resolve(true)
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      s.off('connect', onConnect)
      resolve(ok)
    }
    const onConnect = () => finish(true)
    s.once('connect', onConnect)
    setTimeout(() => finish(false), timeoutMs)
  })
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

/**
 * Emite un evento y espera el acknowledgment del servidor.
 * Devuelve una Promise con la respuesta.
 */
export function emitAsync<T = any>(event: string, payload: any, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const s = getSocket()
    if (!s?.connected) return reject(new Error('Socket no conectado'))

    const timer = setTimeout(() => reject(new Error('Timeout esperando respuesta')), timeoutMs)

    s.emit(event, payload, (response: T) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}
