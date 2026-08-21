/**
 * Store del módulo Abonos: listado con filtros, resumen, ABM, flujos de dos pasos
 * (actualizar precios / facturar, con operationId idempotente) y facturaciones.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'
import type { PaginationMeta } from '@/types'

export interface Abono {
  id: number
  clienteId: number
  servicioId: number
  descripcion?: string | null
  moneda: 'ARS' | 'USD'
  precio: number | string
  fechaInicio: string
  periodoMeses: number
  fechaUltimaActualizacion?: string | null
  formaFacturacionId?: number | null
  observaciones?: string | null
  activo: boolean
  diasParaActualizar?: number | null
  proximaActualizacion?: string | null
  cliente?: { id: number; nombre: string }
  servicio?: { id: number; nombre: string }
  formaFacturacion?: { id: number; nombre: string } | null
}

export interface ResumenAbonos {
  activos: number
  totalPesos: number
  proximos: number
  vencidos: number
  cotizacion: number
}

export interface AbonoFiltros {
  clienteId?: number
  moneda?: string
  estado?: string
  activo?: string
  search?: string
  /** Orden pedido al servidor (columna del catálogo del backend) — ver `ordenSeguro`. */
  orden?: string
  dir?: string
}

export const useAbonosStore = defineStore('abonos', () => {
  const rows = ref<Abono[]>([])
  const meta = ref<PaginationMeta | null>(null)
  const resumen = ref<ResumenAbonos | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  /** Serializa filtros a params (omite vacíos). */
  const params = (filtros: AbonoFiltros, page: number) => ({
    page,
    limit: 50,
    clienteId: filtros.clienteId || undefined,
    moneda: filtros.moneda || undefined,
    estado: filtros.estado || undefined,
    activo: filtros.activo || undefined,
    search: filtros.search || undefined,
    orden: filtros.orden || undefined,
    dir: filtros.dir || undefined,
  })

  /** Carga listado + resumen en paralelo (mismos filtros). */
  async function fetchAll(filtros: AbonoFiltros = {}, page = 1): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const [listRes, resRes] = await Promise.all([
        api.get('/abonos', { params: params(filtros, page) }),
        api.get('/abonos/resumen', { params: params(filtros, 1) }),
      ])
      if (listRes.data.success) {
        rows.value = listRes.data.data
        meta.value = listRes.data.meta ?? null
      }
      if (resRes.data.success) resumen.value = resRes.data.data
    } catch (e) {
      error.value = apiErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  /** Un abono con historial de actualizaciones. */
  async function fetchOne(id: number): Promise<{ abono: Abono; historial: unknown[] } | null> {
    try {
      const [a, h] = await Promise.all([
        api.get(`/abonos/${id}`),
        api.get(`/abonos/${id}/actualizaciones`),
      ])
      if (!a.data.success) return null
      return { abono: a.data.data, historial: h.data.success ? h.data.data : [] }
    } catch {
      return null
    }
  }

  /** Alta / edición. */
  async function save(input: Record<string, unknown>, id?: number): Promise<{ ok: boolean; message: string }> {
    saving.value = true
    try {
      const { data } = id ? await api.put(`/abonos/${id}`, input) : await api.post('/abonos', input)
      return { ok: !!data.success, message: data.message }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    } finally {
      saving.value = false
    }
  }

  async function toggleActive(id: number): Promise<{ ok: boolean; message: string; abono?: Abono }> {
    try {
      const { data } = await api.patch(`/abonos/${id}/active`)
      return { ok: !!data.success, message: data.message, abono: data.data }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    }
  }

  async function remove(id: number): Promise<{ ok: boolean; message: string }> {
    try {
      const { data } = await api.delete(`/abonos/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    }
  }

  // ── Flujos de dos pasos ──

  async function actualizarPreview(ids: number[], input: Record<string, unknown>) {
    const { data } = await api.post('/abonos/actualizar/preview', { ids, ...input })
    return data
  }

  async function actualizarAplicar(ids: number[], input: Record<string, unknown>) {
    const { data } = await api.post('/abonos/actualizar', { ids, ...input, operationId: crypto.randomUUID() })
    return data
  }

  async function facturarPreview(ids: number[], anio: number, mes: number) {
    const { data } = await api.post('/abonos/facturar/preview', { ids, anio, mes })
    return data
  }

  async function facturarAplicar(ids: number[], anio: number, mes: number) {
    const { data } = await api.post('/abonos/facturar', { ids, anio, mes, operationId: crypto.randomUUID() })
    return data
  }

  // ── Facturaciones ──

  async function fetchFacturaciones(filtros: Record<string, unknown> = {}, page = 1) {
    const { data } = await api.get('/abonos/facturaciones', { params: { ...filtros, page, limit: 50 } })
    return data
  }

  async function anularFacturacion(id: number, motivo: string): Promise<{ ok: boolean; message: string }> {
    try {
      const { data } = await api.post(`/abonos/facturaciones/${id}/anular`, { motivo })
      return { ok: !!data.success, message: data.message }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    }
  }

  function reset(): void {
    rows.value = []
    meta.value = null
    resumen.value = null
    error.value = ''
  }

  return {
    rows, meta, resumen, loading, saving, error,
    fetchAll, fetchOne, save, toggleActive, remove,
    actualizarPreview, actualizarAplicar, facturarPreview, facturarAplicar,
    fetchFacturaciones, anularFacturacion, reset,
  }
})
