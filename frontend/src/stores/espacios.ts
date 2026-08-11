/**
 * Store del módulo Espacios (administración): ABM + matriz de accesos de doble eje.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'

export interface UsuarioAcceso {
  id: number
  nombre: string
  activo: boolean
  porRol: boolean
  ver: boolean
  editar: boolean
}

export interface Espacio {
  id: number
  nombre: string
  descripcion?: string | null
  activo: boolean
  listasCount: number
  tareasCount: number
  usuarios: UsuarioAcceso[]
}

export interface FilaMatrizEspacio {
  userId: number
  nombre: string
  activo: boolean
  porRol: boolean
  ver: boolean
  editar: boolean
}

export interface FilaEspacioUsuario {
  espacioId: number
  nombre: string
  activo: boolean
  ver: boolean
  editar: boolean
}

type Result = { ok: boolean; message: string; errorCode?: string; deletedId?: number }

/** Normaliza una respuesta axios/negocio a { ok, message, errorCode?, deletedId? }. */
function toResult(e: unknown): Result {
  const err = e as { response?: { data?: { message?: string; errorCode?: string; data?: { deletedId?: number } } } }
  return {
    ok: false,
    message: apiErrorMessage(e),
    errorCode: err.response?.data?.errorCode,
    deletedId: err.response?.data?.data?.deletedId,
  }
}

export const useEspaciosStore = defineStore('espacios', () => {
  const rows = ref<Espacio[]>([])
  const loading = ref(false)

  async function fetchAll(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/espacios')
      if (data.success) rows.value = data.data
    } finally {
      loading.value = false
    }
  }

  async function save(input: { nombre: string; descripcion?: string; activo?: boolean }, id?: number): Promise<Result> {
    try {
      const { data } = id ? await api.put(`/espacios/${id}`, input) : await api.post('/espacios', input)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function toggle(id: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/espacios/${id}/active`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function restore(id: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/espacios/${id}/restore`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function remove(id: number): Promise<Result> {
    try {
      const { data } = await api.delete(`/espacios/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  // ── Matrices ──

  async function fetchMatriz(espacioId: number): Promise<FilaMatrizEspacio[] | null> {
    try {
      const { data } = await api.get(`/espacios/${espacioId}/usuarios`)
      return data.success ? data.data : null
    } catch { return null }
  }

  async function saveMatriz(espacioId: number, usuarios: Array<{ userId: number; ver: boolean; editar: boolean }>): Promise<Result> {
    try {
      const { data } = await api.put(`/espacios/${espacioId}/usuarios`, { usuarios })
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function fetchEspaciosUsuario(userId: number): Promise<{ porRol: boolean; espacios: FilaEspacioUsuario[] } | null> {
    try {
      const { data } = await api.get(`/espacios/usuario/${userId}`)
      return data.success ? data.data : null
    } catch { return null }
  }

  async function saveEspaciosUsuario(userId: number, espacios: Array<{ espacioId: number; ver: boolean; editar: boolean }>): Promise<Result> {
    try {
      const { data } = await api.put(`/espacios/usuario/${userId}`, { espacios })
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  function reset(): void {
    rows.value = []
  }

  return { rows, loading, fetchAll, save, toggle, restore, remove, fetchMatriz, saveMatriz, fetchEspaciosUsuario, saveEspaciosUsuario, reset }
})
