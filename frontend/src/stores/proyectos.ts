/**
 * Store del módulo Proyectos: listado con filtros, ABM, cobranzas por proyecto
 * (cuotas + KPIs + auditoría) y la grilla anual global.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'
import type { PaginationMeta } from '@/types'

export const ESTADOS_PROYECTO: Record<string, { label: string; badge: string }> = {
  en_diseno: { label: 'En diseño', badge: 'ds-badge-accent' },
  en_desarrollo: { label: 'En desarrollo', badge: 'ds-badge-accent' },
  esperando_cliente: { label: 'Esperando cliente', badge: 'ds-badge-warn' },
  finalizado: { label: 'Finalizado', badge: 'ds-badge-ok' },
  finalizado_incompleto: { label: 'Finalizado incompleto', badge: 'ds-badge-neutral' },
}

/** Estados "abiertos" (filtro por defecto, regla del legado). */
export const ESTADOS_ABIERTOS = ['en_diseno', 'en_desarrollo', 'esperando_cliente']

export interface Proyecto {
  id: number
  clienteId: number
  nombre: string
  servicioId?: number | null
  estado: string
  moneda: 'ARS' | 'USD'
  total: number | string
  fechaConfirmacion?: string | null
  fechaOnboarding?: string | null
  fechaAprobacionDiseno?: string | null
  fechaEstimadaEntrega?: string | null
  fechaEntrega?: string | null
  observaciones?: string | null
  diasParaEntrega?: number | null
  cliente?: { id: number; nombre: string }
  servicio?: { id: number; nombre: string; area?: { id: number; nombre: string } | null } | null
}

export interface Cuota {
  id: number
  proyectoId: number
  anio: number
  mes: number
  montoUsd: string
  cobrado: boolean
  montoPesos?: string | null
  cotizacion?: string | null
  fechaCobro?: string | null
  enPesos: number
}

export interface CobranzasDetalle {
  proyecto: Proyecto
  cuotas: Cuota[]
  kpis: {
    cotizacion: number
    presupuestoUsd: number
    planUsd: number
    cobradoUsd: number
    cobradoPesos: number
    faltaPlanificar: number
    faltaCobrar: number
  }
  eventos: Array<{ id: number; tipo: string; detalle?: string | null; createdAt: string; user?: { name: string; lastName: string } | null }>
}

export const useProyectosStore = defineStore('proyectos', () => {
  const rows = ref<Proyecto[]>([])
  const meta = ref<PaginationMeta | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  async function fetchList(opts: { estado?: string; search?: string; page?: number; orden?: string; dir?: string } = {}): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/proyectos', {
        params: {
          page: opts.page ?? 1, limit: 50,
          estado: opts.estado || undefined, search: opts.search || undefined,
          orden: opts.orden || undefined, dir: opts.dir || undefined,
        },
      })
      if (data.success) {
        rows.value = data.data
        meta.value = data.meta ?? null
      }
    } catch (e) {
      error.value = apiErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id: number): Promise<Proyecto | null> {
    try {
      const { data } = await api.get(`/proyectos/${id}`)
      return data.success ? data.data : null
    } catch { return null }
  }

  async function save(input: Record<string, unknown>, id?: number): Promise<{ ok: boolean; message: string }> {
    saving.value = true
    try {
      const { data } = id ? await api.put(`/proyectos/${id}`, input) : await api.post('/proyectos', input)
      return { ok: !!data.success, message: data.message }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    } finally {
      saving.value = false
    }
  }

  async function remove(id: number): Promise<{ ok: boolean; message: string }> {
    try {
      const { data } = await api.delete(`/proyectos/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    }
  }

  // ── Cobranzas ──

  async function fetchCobranzas(proyectoId: number): Promise<CobranzasDetalle | null> {
    try {
      const { data } = await api.get(`/proyectos/${proyectoId}/cobranzas`)
      return data.success ? data.data : null
    } catch { return null }
  }

  /** Acción genérica de cuota que devuelve { ok, message }. */
  async function accion(fn: () => Promise<{ data: { success: boolean; message: string } }>): Promise<{ ok: boolean; message: string }> {
    try {
      const { data } = await fn()
      return { ok: !!data.success, message: data.message }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    }
  }

  const addCuota = (proyectoId: number, input: { anio: number; mes: number; montoUsd: number }) =>
    accion(() => api.post(`/proyectos/${proyectoId}/cobranzas`, input))
  const editarMonto = (proyectoId: number, cuotaId: number, montoUsd: number) =>
    accion(() => api.patch(`/proyectos/${proyectoId}/cobranzas/${cuotaId}/monto`, { montoUsd }))
  const moverCuotas = (proyectoId: number, cobranzaIds: number[], anio: number, mes: number) =>
    accion(() => api.patch(`/proyectos/${proyectoId}/cobranzas/mover`, { cobranzaIds, anio, mes }))
  const cobrar = (proyectoId: number, cuotaId: number, montoPesos: number) =>
    accion(() => api.post(`/proyectos/${proyectoId}/cobranzas/${cuotaId}/cobrar`, { montoPesos }))
  const descobrar = (proyectoId: number, cuotaId: number) =>
    accion(() => api.post(`/proyectos/${proyectoId}/cobranzas/${cuotaId}/descobrar`))
  const eliminarCuota = (proyectoId: number, cuotaId: number) =>
    accion(() => api.delete(`/proyectos/${proyectoId}/cobranzas/${cuotaId}`))

  async function fetchGrilla(anio: number) {
    const { data } = await api.get('/proyectos/grilla', { params: { anio } })
    return data.success ? data.data : null
  }

  function reset(): void {
    rows.value = []
    meta.value = null
    error.value = ''
  }

  return {
    rows, meta, loading, saving, error,
    fetchList, fetchOne, save, remove,
    fetchCobranzas, addCuota, editarMonto, moverCuotas, cobrar, descobrar, eliminarCuota,
    fetchGrilla, reset,
  }
})
