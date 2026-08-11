/**
 * Store de notificaciones in-app: lista + contador de no leídas + entrega en vivo
 * (el socket emite `notificacion` al room personal; acá se registra el listener).
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/services/api'
import { connectSocket, getSocket } from '@/services/socket'

export interface Notificacion {
  id: number
  tipo: string
  titulo: string
  cuerpo?: string | null
  url?: string | null
  leidaAt?: string | null
  createdAt: string
}

export const useNotificacionesStore = defineStore('notificaciones', () => {
  const rows = ref<Notificacion[]>([])
  const noLeidas = ref(0)
  const loading = ref(false)
  let escuchando = false

  async function fetchAll(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/notificaciones')
      if (data.success) {
        rows.value = data.data.rows
        noLeidas.value = data.data.noLeidas
      }
    } finally {
      loading.value = false
    }
  }

  /** Conecta el socket (si hace falta) y escucha las notificaciones en vivo. */
  function escuchar(): void {
    if (escuchando) return
    escuchando = true
    const socket = getSocket() ?? connectSocket()
    socket.on('notificacion', (n: Notificacion) => {
      rows.value = [n, ...rows.value].slice(0, 50)
      noLeidas.value += 1
    })
  }

  async function marcarLeidas(ids?: number[]): Promise<void> {
    try {
      await api.patch('/notificaciones/leidas', ids?.length ? { ids } : {})
      const ahora = new Date().toISOString()
      rows.value = rows.value.map(n => (!ids || ids.includes(n.id)) && !n.leidaAt ? { ...n, leidaAt: ahora } : n)
      noLeidas.value = ids?.length ? Math.max(0, noLeidas.value - ids.length) : 0
    } catch { /* best-effort */ }
  }

  function reset(): void {
    rows.value = []
    noLeidas.value = 0
    escuchando = false
  }

  return { rows, noLeidas, loading, fetchAll, escuchar, marcarLeidas, reset }
})
