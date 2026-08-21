/**
 * Tareas en vivo: refresca el listado cuando OTRO usuario cambia algo.
 *
 * Va sobre el Socket.IO que la app ya tiene abierto y autenticado (el mismo de la campana),
 * en vez de montar un canal aparte. El backend ya emite en cada mutación de tarea; acá se
 * escucha y se vuelve a pedir la vista.
 *
 * Dos cuidados que evitan que moleste más de lo que ayuda:
 *  - **Se agrupan las ráfagas**: crear una tarea en cinco listas dispara cinco eventos, y
 *    recargar cinco veces seguidas haría parpadear la pantalla. Se espera un momento y se
 *    recarga UNA vez.
 *  - **Solo con la vista activa**: si el usuario se fue a otra pantalla no se recarga nada;
 *    al volver, la propia vista ya recarga por su cuenta.
 */
import { onUnmounted } from 'vue'
import { getSocket, connectSocket } from '@/services/socket'

/** Eventos que emite el backend en cada mutación de tarea. */
const EVENTOS = [
  'tarea:creada', 'tarea:actualizada', 'tarea:estado', 'tarea:eliminada', 'tarea:comentario',
  'lista:created', 'lista:updated', 'lista:deleted',
]

/** Ventana para juntar eventos seguidos (ms). */
const AGRUPAR_MS = 400

export function useTareasEnVivo(recargar: () => void | Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let activo = false
  let enganchado = false

  const alEvento = (): void => {
    if (!activo) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void recargar() }, AGRUPAR_MS)
  }

  /** Empieza a escuchar (llamalo al entrar a la vista). */
  function escuchar(): void {
    activo = true
    if (enganchado) return
    let socket = getSocket()
    if (!socket) { try { socket = connectSocket() } catch { return } }
    if (!socket) return
    for (const ev of EVENTOS) socket.on(ev, alEvento)
    enganchado = true
  }

  /** Deja de reaccionar (al salir de la vista). Los listeners se quitan al desmontar. */
  function pausar(): void {
    activo = false
    if (timer) { clearTimeout(timer); timer = null }
  }

  onUnmounted(() => {
    pausar()
    const socket = getSocket()
    if (socket && enganchado) for (const ev of EVENTOS) socket.off(ev, alEvento)
    enganchado = false
  })

  return { escuchar, pausar }
}
