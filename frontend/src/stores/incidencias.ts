/**
 * Incidencias desde el SISTEMA INTERNO: ver las de todos los clientes, cargarlas en su nombre,
 * mover el estado y convertirlas en tareas.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'

/** Estados de una incidencia. Son los que ve el cliente: menos que los de una tarea, a propósito. */
export const ESTADOS_INCIDENCIA: Record<string, { label: string; color: string }> = {
  nueva: { label: 'Nueva', color: '#64748b' },
  en_progreso: { label: 'En progreso', color: '#2563eb' },
  resuelta: { label: 'Resuelta', color: '#12855f' },
}
/** Estados terminados: van al fondo del listado, acá y en el portal. */
export const ESTADOS_TERMINADOS = ['resuelta']

export interface IncidenciaRow {
  id: number
  titulo: string
  descripcion: string | null
  estado: string
  clienteId: number
  servicioId: number | null
  tareaId: number | null
  fechaEstimada: string | null
  createdAt: string
  cliente?: { id: number; nombre: string } | null
  servicio?: { id: number; nombre: string } | null
  tarea?: { id: number; nombre: string; estado: string; espacioId: number; listaId: number } | null
  archivos?: Array<{ id: number; nombreOriginal: string | null; url: string }>
  historial?: Array<{ id: number; evento: string; detalle: string | null; createdAt: string }>
}

export const useIncidenciasStore = defineStore('incidencias', () => {
  const rows = ref<IncidenciaRow[]>([])
  const loading = ref(false)
  const error = ref('')

  /** Envuelve una mutación devolviendo `{ ok, message, data }`, como el resto de los stores. */
  const accion = async (fn: () => Promise<{ data: { success: boolean; message: string; data?: unknown } }>) => {
    try {
      const { data } = await fn()
      return data.success
        ? { ok: true as const, message: data.message, data: data.data }
        : { ok: false as const, message: data.message }
    } catch (e) {
      return { ok: false as const, message: apiErrorMessage(e) }
    }
  }

  /**
   * Trae el listado con filtros.
   * @param filtros - clienteId, estado (coma), texto, incluirCerradas.
   */
  async function fetchIncidencias(filtros: Record<string, string | number | undefined> = {}): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.get('/incidencias', { params: filtros })
      if (data.success) rows.value = data.data
    } catch (e) {
      error.value = apiErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  async function fetchIncidencia(id: number): Promise<IncidenciaRow | null> {
    try {
      const { data } = await api.get(`/incidencias/${id}`)
      return data.success ? data.data : null
    } catch { return null }
  }

  /** Servicios que ese cliente puede elegir (abonos activos + proyectos). */
  async function fetchServicios(clienteId: number): Promise<Array<{ id: number; nombre: string }>> {
    try {
      const { data } = await api.get(`/incidencias/servicios/${clienteId}`)
      return data.success ? data.data : []
    } catch { return [] }
  }

  const crear = (datos: Record<string, unknown>) => accion(() => api.post('/incidencias', datos))
  const actualizar = (id: number, datos: Record<string, unknown>) => accion(() => api.put(`/incidencias/${id}`, datos))
  const cambiarEstado = (id: number, estado: string) => accion(() => api.patch(`/incidencias/${id}/estado`, { estado }))
  const eliminar = (id: number) => accion(() => api.delete(`/incidencias/${id}`))
  /** Crea la tarea a partir de la incidencia y las deja vinculadas. */
  /**
   * Crea la tarea a partir de la incidencia. `fechaVencimiento` es opcional y es lo que el
   * cliente ve como fecha estimada de resolución en su portal.
   */
  const crearTarea = (id: number, listaId: number, fechaVencimiento?: string) =>
    accion(() => api.post(`/incidencias/${id}/tarea`, { listaId, fechaVencimiento: fechaVencimiento || undefined }))

  function reset(): void {
    rows.value = []
    error.value = ''
  }

  return {
    rows, loading, error,
    fetchIncidencias, fetchIncidencia, fetchServicios,
    crear, actualizar, cambiarEstado, eliminar, crearTarea, reset,
  }
})
