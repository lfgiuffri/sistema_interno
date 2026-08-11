/**
 * Store del módulo Empleados: listado, ficha (vacaciones + archivos) y acciones.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'

export const CATEGORIAS = ['Socio', 'Relación de dependencia', 'Monotributo', 'Freelance'] as const
export const ESTADOS_CIVILES = ['Soltero/a', 'Casado/a', 'Divorciado/a', 'Viudo/a', 'En pareja', 'Otro'] as const

export interface EmpleadoRow {
  id: number
  nombre: string
  categoria: string
  activo: boolean
  email?: string | null
  telefono?: string | null
  fechaIngreso?: string | null
  areas: Array<{ id: number; nombre: string }>
  vacaciones?: { aplica: boolean; disponible?: number; sobregiro?: number }
}

export interface VacacionesEstado {
  aplica: boolean
  dispAnterior: number
  dispActual: number
  disponible: number
  venceAnterior: string
  venceActual: string
  tomadosAnio: number
  sobregiro: number
  tomas: Array<{ id: number; fechaDesde: string; fechaHasta: string; dias: number; observacion?: string | null; sobregiro: number }>
  grantsDetalle: Array<{ anio: number; dias: number; origen: string }>
}

export interface FichaEmpleado extends Omit<EmpleadoRow, 'vacaciones'> {
  dni?: string | null
  cuil?: string | null
  nacionalidad?: string | null
  fechaNacimiento?: string | null
  domicilio?: string | null
  estadoCivil?: string | null
  cargasFamiliares?: string | null
  cuNombre?: string | null
  cuTelefono?: string | null
  cuParentesco?: string | null
  observaciones?: string | null
  vacDiasAnuales: number
  sueldo: number
  vacaciones?: VacacionesEstado | { aplica: false }
  archivos?: Array<{ id: number; descripcion: string; nombreOriginal: string; mime: string; size: number; fecha: string; usuario?: string | null }>
}

type Result = { ok: boolean; message: string; data?: unknown }

/** Normaliza un error axios a Result. */
function toResult(e: unknown): Result {
  return { ok: false, message: apiErrorMessage(e) }
}

export const useEmpleadosStore = defineStore('empleados', () => {
  const rows = ref<EmpleadoRow[]>([])
  const loading = ref(false)

  async function fetchAll(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/empleados')
      if (data.success) rows.value = data.data
    } finally {
      loading.value = false
    }
  }

  async function fetchFicha(id: number): Promise<FichaEmpleado | null> {
    try {
      const { data } = await api.get(`/empleados/${id}`)
      return data.success ? data.data : null
    } catch { return null }
  }

  const accion = async (fn: () => Promise<{ data: { success: boolean; message: string; data?: unknown } }>): Promise<Result> => {
    try {
      const { data } = await fn()
      return { ok: !!data.success, message: data.message, data: data.data }
    } catch (e) { return toResult(e) }
  }

  const save = (input: Record<string, unknown>, id?: number) =>
    accion(() => (id ? api.put(`/empleados/${id}`, input) : api.post('/empleados', input)))
  const toggle = (id: number) => accion(() => api.patch(`/empleados/${id}/active`))
  const remove = (id: number) => accion(() => api.delete(`/empleados/${id}`))

  // Vacaciones
  const addToma = (id: number, input: { fechaDesde: string; fechaHasta: string; observacion?: string }) =>
    accion(() => api.post(`/empleados/${id}/vacaciones/tomas`, input))
  const removeToma = (id: number, tomaId: number) =>
    accion(() => api.delete(`/empleados/${id}/vacaciones/tomas/${tomaId}`))
  const setAsignacion = (id: number, anio: number, dias: number | null) =>
    accion(() => api.put(`/empleados/${id}/vacaciones/asignacion`, { anio, dias }))

  // Archivos
  async function subirArchivo(id: number, file: File, descripcion: string): Promise<Result> {
    try {
      const form = new FormData()
      form.append('archivo', file)
      form.append('descripcion', descripcion)
      const { data } = await api.post(`/empleados/${id}/archivos`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      return { ok: !!data.success, message: data.message, data: data.data }
    } catch (e) { return toResult(e) }
  }

  const removeArchivo = (id: number, archivoId: number) =>
    accion(() => api.delete(`/empleados/${id}/archivos/${archivoId}`))

  /** Descarga un archivo protegido con su nombre real. */
  async function descargarArchivo(archivoId: number, nombre: string): Promise<void> {
    const res = await api.get(`/empleados/archivos/${archivoId}`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = nombre
    a.click()
    URL.revokeObjectURL(url)
  }

  function reset(): void {
    rows.value = []
  }

  return { rows, loading, fetchAll, fetchFicha, save, toggle, remove, addToma, removeToma, setAsignacion, subirArchivo, removeArchivo, descargarArchivo, reset }
})
