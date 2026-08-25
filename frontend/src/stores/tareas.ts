/**
 * Store del módulo Tareas: home de espacios, listas por espacio, listado central con
 * filtros, detalle con historial, resumen por categorías y subida de archivos.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'

// Catálogos (mismo orden y colores que el legado).
export const ESTADOS_TAREA: Record<string, { label: string; color: string }> = {
  abierta: { label: 'Abierta', color: '#64748b' },
  en_progreso: { label: 'En progreso', color: '#2563eb' },
  pausada: { label: 'Pausada', color: '#7c3aed' },
  en_revision: { label: 'En revisión', color: '#b45309' },
  completada: { label: 'Completada', color: '#12855f' },
}

export const PRIORIDADES: Record<string, { label: string; color: string; peso: number }> = {
  verde: { label: 'Baja', color: '#1baf7a', peso: 1 },
  amarillo: { label: 'Media', color: '#eab308', peso: 2 },
  naranja: { label: 'Alta', color: '#ea7317', peso: 3 },
  rojo: { label: 'Urgente', color: '#e34948', peso: 4 },
}

export interface EspacioHome {
  id: number
  nombre: string
  descripcion?: string | null
  editar: boolean
  pendientes: number
  vencidas: number
  listas: number
}

export interface MiResumen {
  pendientes: number
  hoy: number
  porVencer: number
  vencidas: number
  enProgreso: number
  pausadas: number
  enRevision: number
  sinFecha: number
  urgentes: number
}

export interface ListaRow {
  id: number
  nombre: string
  descripcion?: string | null
  activa: boolean
  total: number
  pendientes: number
  vencidas: number
  proximoVencimiento?: string | null
}

export interface TareaRow {
  id: number
  espacioId: number
  listaId: number
  nombre: string
  tieneDescripcion: boolean
  asignadoA?: number | null
  creadoPor?: number | null
  prioridad: string
  estado: string
  fechaInicio?: string | null
  fechaVencimiento?: string | null
  createdAt: string
  asignado?: { id: number; name: string; lastName: string } | null
  creador?: { id: number; name: string; lastName: string } | null
}

export interface Comentario {
  id: number
  texto: string
  userId: number
  usuario: string
  fecha: string
}

export interface TareaDetalle extends Omit<TareaRow, 'tieneDescripcion'> {
  descripcion: string
  tiempoTrabajado: number
  comentarios: Comentario[]
  /** Bitácora de TODOS los cambios (no solo estados): una entrada por campo modificado. */
  historial: Array<{
    id: number
    campo: string
    campoLabel: string
    valorAnterior: string | null
    valorNuevo: string | null
    usuario: string | null
    fecha: string
  }>
  archivos: Array<{ id: number; nombre: string; nombreOriginal: string; tipo: string; mime: string; size: number; url: string }>
  lista?: { id: number; nombre: string }
}

export interface FiltrosTareas {
  texto?: string
  estado?: string
  prioridad?: string
  asignadoA?: string
  creadoPor?: string
  vencDesde?: string
  vencHasta?: string
  inicioDesde?: string
  inicioHasta?: string
  creadaDesde?: string
  creadaHasta?: string
  soloVencidas?: string
  sinVencimiento?: string
  conDescripcion?: string
  incluirCompletadas?: string
}

type Result = { ok: boolean; message: string; errorCode?: string; deletedId?: number; data?: unknown }

/** Normaliza un error axios a Result (con errorCode/deletedId si el backend los mandó). */
function toResult(e: unknown): Result {
  const err = e as { response?: { data?: { message?: string; errorCode?: string; data?: { deletedId?: number } } } }
  return {
    ok: false,
    message: apiErrorMessage(e),
    errorCode: err.response?.data?.errorCode,
    deletedId: err.response?.data?.data?.deletedId,
  }
}

export const useTareasStore = defineStore('tareas', () => {
  const homeEspacios = ref<EspacioHome[]>([])
  const miResumen = ref<MiResumen | null>(null)
  const diasPorVencer = ref(3)
  const loading = ref(false)

  async function fetchHome(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/tareas/espacios')
      if (data.success) {
        homeEspacios.value = data.data.espacios
        miResumen.value = data.data.miResumen
        diasPorVencer.value = data.data.diasPorVencer
      }
    } finally {
      loading.value = false
    }
  }

  async function fetchListas(espacioId: number) {
    const { data } = await api.get(`/tareas/espacios/${espacioId}/listas`)
    return data.success ? data.data as { espacio: { id: number; nombre: string; activo: boolean }; puedeEditar: boolean; listas: ListaRow[] } : null
  }

  async function saveLista(espacioId: number, input: { nombre: string; descripcion?: string }, listaId?: number): Promise<Result> {
    try {
      const { data } = listaId
        ? await api.put(`/tareas/espacios/${espacioId}/listas/${listaId}`, input)
        : await api.post(`/tareas/espacios/${espacioId}/listas`, input)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  const accion = async (fn: () => Promise<{ data: { success: boolean; message: string; data?: unknown } }>): Promise<Result> => {
    try {
      const { data } = await fn()
      return { ok: !!data.success, message: data.message, data: data.data }
    } catch (e) { return toResult(e) }
  }

  const toggleLista = (eid: number, lid: number) => accion(() => api.patch(`/tareas/espacios/${eid}/listas/${lid}/active`))
  const restoreLista = (eid: number, lid: number) => accion(() => api.patch(`/tareas/espacios/${eid}/listas/${lid}/restore`))
  const removeLista = (eid: number, lid: number) => accion(() => api.delete(`/tareas/espacios/${eid}/listas/${lid}`))
  /** Clona una lista con todas sus tareas (el backend numera el nombre: «… (copia 2)»). */
  const clonarLista = (eid: number, lid: number, conTareas = true) =>
    accion(() => api.post(`/tareas/espacios/${eid}/listas/${lid}/clonar`, { conTareas }))
  /** Clona una tarea; sin `listaId` queda en la misma lista. */
  const clonarTarea = (id: number, listaId?: number) =>
    accion(() => api.post(`/tareas/${id}/clonar`, listaId ? { listaId } : {}))

  async function fetchTareas(espacioId: number, listaId: number, filtros: FiltrosTareas) {
    const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== undefined && v !== ''))
    const { data } = await api.get(`/tareas/espacios/${espacioId}/listas/${listaId}/tareas`, { params })
    return data.success
      ? data.data as { espacio: { id: number; nombre: string }; lista: { id: number; nombre: string; activa: boolean }; puedeEditar: boolean; tareas: TareaRow[]; total: number }
      : null
  }

  async function fetchTarea(id: number): Promise<TareaDetalle | null> {
    try {
      const { data } = await api.get(`/tareas/${id}`)
      return data.success ? data.data : null
    } catch { return null }
  }

  const createTarea = (input: Record<string, unknown>) => accion(() => api.post('/tareas', input))
  const updateTarea = (id: number, input: Record<string, unknown>) => accion(() => api.put(`/tareas/${id}`, input))
  const updateRapida = (id: number, input: Record<string, unknown>) => accion(() => api.patch(`/tareas/${id}/rapida`, input))
  const cambiarEstado = (id: number, estado: string) => accion(() => api.patch(`/tareas/${id}/estado`, { estado }))
  const moverTarea = (id: number, listaId: number) => accion(() => api.patch(`/tareas/${id}/mover`, { listaId }))
  const removeTarea = (id: number) => accion(() => api.delete(`/tareas/${id}`))

  async function fetchAsignables(): Promise<Array<{ id: number; nombre: string; username: string }>> {
    const { data } = await api.get('/tareas/asignables')
    return data.success ? data.data : []
  }

  /** `e`: ids de espacio separados por coma (filtro múltiple; vacío = todos los visibles). */
  async function fetchResumen(f: string, u: string, e = '') {
    const { data } = await api.get('/tareas/resumen', { params: { f, u, e } })
    return data.success ? data.data : null
  }

  /**
   * Pantalla de Análisis de tareas: TODOS los bloques en una sola llamada (equipo, listas,
   * espacios, rango de realizadas, serie anual, antigüedad y prioridad).
   * @param params - desde/hasta (ISO), anio, e (ids por coma), estancadas (días).
   */
  async function fetchAnalisis(params: Record<string, string | number>) {
    const { data } = await api.get('/tareas/analisis', { params })
    return data.success ? data.data : null
  }

  /** Sube un archivo (imagen del editor o adjunto). Devuelve el registro con su URL. */
  /**
   * Sube un archivo.
   * @param destino - 'adjunto' (botón «Adjuntar») o 'editor' (imagen del cuerpo). Define si
   *   queda listado como adjunto o como contenido de la descripción.
   */
  async function subirArchivo(
    file: File, tareaId?: number, destino: 'editor' | 'adjunto' = 'editor',
  ): Promise<Result & { url?: string }> {
    try {
      const form = new FormData()
      form.append('archivo', file)
      form.append('destino', destino)
      if (tareaId) form.append('tareaId', String(tareaId))
      const { data } = await api.post('/tareas/archivos', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      return { ok: !!data.success, message: data.message, url: data.data?.url, data: data.data }
    } catch (e) { return toResult(e) }
  }

  const removeArchivo = (id: number) => accion(() => api.delete(`/tareas/archivos/${id}`))
  const addComentario = (tareaId: number, texto: string) => accion(() => api.post(`/tareas/${tareaId}/comentarios`, { texto }))
  const removeComentario = (id: number) => accion(() => api.delete(`/tareas/comentarios/${id}`))

  function reset(): void {
    homeEspacios.value = []
    miResumen.value = null
  }

  return {
    homeEspacios, miResumen, diasPorVencer, loading,
    fetchHome, fetchListas, saveLista, toggleLista, restoreLista, removeLista,
    fetchTareas, fetchTarea, createTarea, updateTarea, updateRapida, cambiarEstado,
    moverTarea, removeTarea, clonarTarea, clonarLista,
    fetchAsignables, fetchResumen, fetchAnalisis, subirArchivo, removeArchivo,
    addComentario, removeComentario,
    reset,
  }
})
