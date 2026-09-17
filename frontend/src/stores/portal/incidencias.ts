/**
 * Incidencias vistas desde el PORTAL. Todo lo que pide va acotado al cliente del usuario
 * logueado por el backend: acá no se manda ningún `clienteId`, justamente para que no exista
 * la posibilidad de mandar el de otro.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import portalApi, { apiErrorMessage } from '@/services/portalApi'

/** Estados de una incidencia, tal como los ve el cliente. */
export const ESTADOS_INCIDENCIA: Record<string, { label: string; color: string }> = {
  nueva: { label: 'Nueva', color: '#64748b' },
  en_progreso: { label: 'En progreso', color: '#2563eb' },
  resuelta: { label: 'Resuelta', color: '#12855f' },
}

/** Las que el cliente considera terminadas: van al fondo del listado. */
export const ESTADOS_TERMINADOS = ['resuelta']

export interface ArchivoIncidencia {
  id: number; nombre: string; nombreOriginal: string | null
  tipo: string; mime: string | null; size: number | null; url: string
}
export interface Incidencia {
  id: number
  titulo: string
  descripcion: string | null
  estado: string
  servicioId: number | null
  servicio?: { id: number; nombre: string } | null
  /** Cuándo estimamos tenerlo resuelto (sale del vencimiento de la tarea, si hay). */
  fechaEstimada: string | null
  createdAt: string
  archivos?: ArchivoIncidencia[]
  historial?: Array<{ id: number; evento: string; estadoNuevo: string | null; detalle: string | null; createdAt: string }>
}

export const usePortalIncidenciasStore = defineStore('portalIncidencias', () => {
  const rows = ref<Incidencia[]>([])
  const servicios = ref<Array<{ id: number; nombre: string }>>([])
  const cargando = ref(false)
  const error = ref('')

  /** Trae las incidencias del cliente (el backend ya las ordena con las terminadas al fondo). */
  async function fetchIncidencias(): Promise<void> {
    cargando.value = true
    error.value = ''
    try {
      const { data } = await portalApi.get('/portal/incidencias')
      if (data.success) rows.value = data.data
    } catch (e) {
      error.value = apiErrorMessage(e)
    } finally {
      cargando.value = false
    }
  }

  /** Servicios que el cliente puede elegir. Puede venir vacío: ahí solo queda «consulta general». */
  async function fetchServicios(): Promise<void> {
    try {
      const { data } = await portalApi.get('/portal/servicios')
      if (data.success) servicios.value = data.data
    } catch {
      servicios.value = []
    }
  }

  /** Detalle de una incidencia propia. */
  async function fetchIncidencia(id: number): Promise<Incidencia | null> {
    try {
      const { data } = await portalApi.get(`/portal/incidencias/${id}`)
      return data.success ? data.data : null
    } catch {
      return null
    }
  }

  /**
   * Carga una incidencia nueva.
   * @param datos - Título, descripción, servicio (opcional) y adjuntos ya subidos.
   */
  async function crear(datos: { titulo: string; descripcion?: string; servicioId?: number | null; archivoIds?: number[] }) {
    try {
      const { data } = await portalApi.post('/portal/incidencias', datos)
      return data.success ? { ok: true as const, data: data.data } : { ok: false as const, message: data.message }
    } catch (e) {
      return { ok: false as const, message: apiErrorMessage(e) }
    }
  }

  /**
   * Sube un adjunto suelto; queda ligado a la incidencia al guardarla.
   * @param file - El archivo.
   */
  async function subirArchivo(file: File) {
    const form = new FormData()
    form.append('archivo', file)
    try {
      const { data } = await portalApi.post('/portal/archivos', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data.success ? { ok: true as const, data: data.data } : { ok: false as const, message: data.message }
    } catch (e) {
      return { ok: false as const, message: apiErrorMessage(e) }
    }
  }

  /** Limpia el estado al cerrar sesión (reset PROPIO: el del sistema interno no aplica acá). */
  function reset(): void {
    rows.value = []
    servicios.value = []
    error.value = ''
  }

  return { rows, servicios, cargando, error, fetchIncidencias, fetchServicios, fetchIncidencia, crear, subirArchivo, reset }
})
