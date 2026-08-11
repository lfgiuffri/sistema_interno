/**
 * Store del módulo Sueldos: listado con vigente, actualización por %, aumentos
 * programados, planificación y historial.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'

export interface SueldoRow {
  id: number
  nombre: string
  categoria: string
  activo: boolean
  vigente: number
  ultCambio?: string | null
  futuros: number
}

export interface HistorialSueldo {
  empleado: { id: number; nombre: string; activo: boolean }
  vigente: number
  historial: Array<{ id: number; fecha: string; tipo: string; anterior: number; nuevo: number; variacion: number | null; usuario?: string | null }>
}

export interface LineaAumento {
  anio: number
  mes: number
  tipo: 'pct' | 'fijo'
  valor: string
}

export interface PreviewAumentos {
  filas: Array<{ empleadoId: number; nombre: string; base: number; valores: Array<{ anio: number; mes: number; tipo: string; valor: number; nuevo: number }> }>
  lineas: Array<{ anio: number; mes: number; tipo: string; valor: number }>
  pisados: Array<{ empleadoId: number; nombre: string; fecha: string; sueldoNuevo: number; tipo: string }>
}

export interface Planificacion {
  anio: number
  mes: number
  anios: number[]
  empleados: Array<{ id: number; nombre: string; sueldoDelMes: number }>
  cuentas: Array<{ id: number; nombre: string }>
  celdas: Array<{ empleadoId: number; cuentaId: number; monto: number; pagado: boolean; fechaPago?: string | null }>
  disponibles: Array<{ cuentaId: number; monto: number }>
}

type Result = { ok: boolean; message: string; data?: unknown }

export const useSueldosStore = defineStore('sueldos', () => {
  const rows = ref<SueldoRow[]>([])
  const activos = ref(0)
  const masaSalarial = ref(0)
  const loading = ref(false)

  async function fetchAll(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/sueldos')
      if (data.success) {
        rows.value = data.data.rows
        activos.value = data.data.activos
        masaSalarial.value = data.data.masaSalarial
      }
    } finally {
      loading.value = false
    }
  }

  const accion = async (fn: () => Promise<{ data: { success: boolean; message: string; data?: unknown } }>): Promise<Result> => {
    try {
      const { data } = await fn()
      return { ok: !!data.success, message: data.message, data: data.data }
    } catch (e) { return { ok: false, message: apiErrorMessage(e) } }
  }

  const setSueldo = (empleadoId: number, sueldo: number) =>
    accion(() => api.put(`/sueldos/${empleadoId}`, { sueldo }))

  async function previewActualizacion(ids: number[], porcentaje: string, overrides: Record<number, string>): Promise<Result> {
    return accion(() => api.post('/sueldos/actualizar/preview', { ids, porcentaje, overrides }))
  }
  const aplicarActualizacion = (ids: number[], porcentaje: string, overrides: Record<number, string>) =>
    accion(() => api.post('/sueldos/actualizar', { ids, porcentaje, overrides }))

  async function fetchHistorial(empleadoId: number): Promise<HistorialSueldo | null> {
    try {
      const { data } = await api.get(`/sueldos/${empleadoId}/historial`)
      return data.success ? data.data : null
    } catch { return null }
  }

  const previewAumentos = (input: { ids: number[]; baseAnio: number; baseMes: number; lineas: LineaAumento[] }) =>
    accion(() => api.post('/sueldos/aumentos/preview', input))
  const aplicarAumentos = (input: { ids: number[]; baseAnio: number; baseMes: number; lineas: LineaAumento[] }) =>
    accion(() => api.post('/sueldos/aumentos', input))

  async function fetchPlanificacion(anio?: number, mes?: number): Promise<Planificacion | null> {
    try {
      const { data } = await api.get('/sueldos/planificacion', { params: { anio, mes } })
      return data.success ? data.data : null
    } catch { return null }
  }
  const savePlanificacion = (input: { anio: number; mes: number; celdas: unknown[]; disponibles: unknown[] }) =>
    accion(() => api.put('/sueldos/planificacion', input))

  function reset(): void {
    rows.value = []
    activos.value = 0
    masaSalarial.value = 0
  }

  return {
    rows, activos, masaSalarial, loading,
    fetchAll, setSueldo, previewActualizacion, aplicarActualizacion, fetchHistorial,
    previewAumentos, aplicarAumentos, fetchPlanificacion, savePlanificacion, reset,
  }
})
