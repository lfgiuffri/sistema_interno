/**
 * CRUD genérico de catálogos (áreas, clientes, servicios, formas de facturación, …).
 *
 * Todos los catálogos del backend comparten la misma API REST:
 *   GET /<endpoint>?page&limit&search&activo · GET /:id · POST / · PUT /:id
 *   PATCH /:id/active · PATCH /:id/restore · DELETE /:id
 * y las mismas reglas (unicidad con oferta de reactivación vía 409 EXISTE_ELIMINADO,
 * protecciones de borrado con 409). Este composable concentra ese contrato una sola vez.
 */
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'
import type { PaginationMeta } from '@/types'

/** Registro genérico de catálogo. */
export interface CatalogoRow {
  id: number
  nombre: string
  activo: boolean
  [key: string]: unknown
}

/** Resultado de guardar: ok, error simple, o "existe eliminado" (ofrecer reactivar). */
export type SaveResult =
  | { status: 'ok'; row: CatalogoRow }
  | { status: 'error'; message: string }
  | { status: 'existe-eliminado'; message: string; deletedId: number }

export function useCatalogo(endpoint: string) {
  const rows = ref<CatalogoRow[]>([])
  const meta = ref<PaginationMeta | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  /**
   * Carga el listado (paginado + búsqueda + filtro de activo).
   * @param opts - { page, limit, search, activo }.
   */
  async function fetchList(opts: { page?: number; limit?: number; search?: string; activo?: string } = {}): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.get(`/${endpoint}`, {
        params: {
          page: opts.page ?? 1,
          limit: opts.limit ?? 50,
          search: opts.search || undefined,
          activo: opts.activo || undefined,
        },
      })
      if (data.success) {
        rows.value = data.data
        meta.value = (data.meta as PaginationMeta) ?? null
      }
    } catch (e) {
      error.value = apiErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  /**
   * Crea o actualiza un registro. Detecta el 409 EXISTE_ELIMINADO para que la UI
   * ofrezca reactivar en lugar de mostrar un error opaco.
   * @param input - Campos del registro.
   * @param id - Id a editar, u omitido para alta.
   */
  async function save(input: Record<string, unknown>, id?: number): Promise<SaveResult> {
    saving.value = true
    try {
      const { data } = id
        ? await api.put(`/${endpoint}/${id}`, input)
        : await api.post(`/${endpoint}`, input)
      if (!data.success) return { status: 'error', message: data.message }
      return { status: 'ok', row: data.data }
    } catch (e: unknown) {
      const resp = (e as { response?: { data?: { message?: string; errorCode?: string; deletedId?: number } } })?.response?.data
      if (resp?.errorCode === 'EXISTE_ELIMINADO' && resp.deletedId) {
        return { status: 'existe-eliminado', message: resp.message ?? '', deletedId: resp.deletedId }
      }
      return { status: 'error', message: apiErrorMessage(e) }
    } finally {
      saving.value = false
    }
  }

  /**
   * Reactiva un registro eliminado.
   * @param id - Id del registro eliminado.
   * @returns El registro restaurado, o null (mensaje en el retorno de error).
   */
  async function restore(id: number): Promise<{ ok: boolean; message: string }> {
    try {
      const { data } = await api.patch(`/${endpoint}/${id}/restore`)
      return { ok: !!data.success, message: data.message }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    }
  }

  /**
   * Alterna el estado activo.
   * @param id - Id del registro.
   */
  async function toggleActive(id: number): Promise<{ ok: boolean; message: string; row?: CatalogoRow }> {
    try {
      const { data } = await api.patch(`/${endpoint}/${id}/active`)
      return { ok: !!data.success, message: data.message, row: data.data }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    }
  }

  /**
   * Elimina (baja lógica). El backend responde 409 con el detalle si está en uso.
   * @param id - Id del registro.
   */
  async function remove(id: number): Promise<{ ok: boolean; message: string }> {
    try {
      const { data } = await api.delete(`/${endpoint}/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) {
      return { ok: false, message: apiErrorMessage(e) }
    }
  }

  return { rows, meta, loading, saving, error, fetchList, save, restore, toggleActive, remove }
}
