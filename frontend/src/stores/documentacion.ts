/**
 * Store del módulo Documentación: espacios propios (con su matriz de accesos), listas,
 * documentos con historial de versiones, adjuntos y buscador.
 *
 * Permisos de dos capas: la capability la gatea el menú/las acciones (`meStore.can`), y el
 * backend además exige ver/editar el ESPACIO — por eso cada respuesta trae `puedeEditar`.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'

export interface DocEspacio {
  id: number
  nombre: string
  descripcion?: string | null
  activo: boolean
  listasCount: number
  documentosCount: number
  puedeEditar?: boolean
  usuarios?: Array<{ id: number; nombre: string; activo: boolean; porRol: boolean; ver: boolean; editar: boolean }>
}

export interface DocLista {
  id: number
  docEspacioId: number
  nombre: string
  descripcion?: string | null
  orden: number
  activa: boolean
  documentosCount: number
}

export interface DocumentoListado {
  id: number
  docEspacioId: number
  docListaId: number
  titulo: string
  extracto: string
  tieneTexto: boolean
  archivosCount: number
  orden: number
  autor?: string | null
  editor?: string | null
  createdAt: string
  updatedAt: string
  espacio?: { id: number; nombre: string } | null
  lista?: { id: number; nombre: string } | null
}

export interface DocumentoArchivo {
  id: number
  nombre: string
  nombreOriginal: string
  tipo: 'imagen' | 'archivo'
  mime: string
  size: number
  url: string
}

export interface Documento {
  id: number
  docEspacioId: number
  docListaId: number
  titulo: string
  contenido: string | null
  autor?: string | null
  editor?: string | null
  lista?: { id: number; nombre: string } | null
  archivos: DocumentoArchivo[]
  puedeEditar: boolean
  createdAt: string
  updatedAt: string
}

export interface DocumentoVersion {
  id: number
  titulo: string
  contenido: string
  usuario?: string | null
  createdAt: string
}

export interface FilaMatrizDocEspacio {
  userId: number
  nombre: string
  activo: boolean
  porRol: boolean
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

export const useDocumentacionStore = defineStore('documentacion', () => {
  const espacios = ref<DocEspacio[]>([])
  const listas = ref<DocLista[]>([])
  const documentos = ref<DocumentoListado[]>([])
  const espacioActual = ref<{ id: number; nombre: string; descripcion?: string | null } | null>(null)
  const listaActual = ref<{ id: number; nombre: string; descripcion?: string | null; activa: boolean } | null>(null)
  const puedeEditar = ref(false)
  const loading = ref(false)

  // ── Home / espacios ──

  async function fetchHome(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/documentacion/espacios')
      if (data.success) espacios.value = data.data
    } finally {
      loading.value = false
    }
  }

  async function buscar(q: string, docEspacioId?: number): Promise<DocumentoListado[]> {
    if (q.trim().length < 2) return []
    try {
      const { data } = await api.get('/documentacion/buscar', { params: { q, docEspacioId } })
      return data.success ? data.data : []
    } catch { return [] }
  }

  // ── Listas ──

  async function fetchListas(espacioId: number): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get(`/documentacion/espacios/${espacioId}/listas`)
      if (data.success) {
        espacioActual.value = data.data.espacio
        listas.value = data.data.listas
        puedeEditar.value = data.data.puedeEditar
      }
    } finally {
      loading.value = false
    }
  }

  async function saveLista(espacioId: number, input: { nombre: string; descripcion?: string }, id?: number): Promise<Result> {
    try {
      const { data } = id
        ? await api.put(`/documentacion/espacios/${espacioId}/listas/${id}`, input)
        : await api.post(`/documentacion/espacios/${espacioId}/listas`, input)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function toggleLista(espacioId: number, id: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/documentacion/espacios/${espacioId}/listas/${id}/active`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function restoreLista(espacioId: number, id: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/documentacion/espacios/${espacioId}/listas/${id}/restore`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function removeLista(espacioId: number, id: number): Promise<Result> {
    try {
      const { data } = await api.delete(`/documentacion/espacios/${espacioId}/listas/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function ordenarListas(espacioId: number, ids: number[]): Promise<Result> {
    try {
      const { data } = await api.patch(`/documentacion/espacios/${espacioId}/listas/orden`, { ids })
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  // ── Documentos ──

  async function fetchDocumentos(espacioId: number, listaId: number): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get(`/documentacion/espacios/${espacioId}/listas/${listaId}/documentos`)
      if (data.success) {
        espacioActual.value = data.data.espacio
        listaActual.value = data.data.lista
        documentos.value = data.data.documentos
        puedeEditar.value = data.data.puedeEditar
      }
    } finally {
      loading.value = false
    }
  }

  async function fetchDocumento(id: number): Promise<Documento | null> {
    try {
      const { data } = await api.get(`/documentacion/documentos/${id}`)
      return data.success ? data.data : null
    } catch { return null }
  }

  async function saveDocumento(
    input: { docEspacioId: number; docListaId: number; titulo: string; contenido?: string | null },
    id?: number,
  ): Promise<Result & { documento?: Documento }> {
    try {
      const { data } = id
        ? await api.put(`/documentacion/documentos/${id}`, { titulo: input.titulo, contenido: input.contenido })
        : await api.post('/documentacion/documentos', input)
      return { ok: !!data.success, message: data.message, documento: data.data }
    } catch (e) { return toResult(e) }
  }

  async function moverDocumento(id: number, docEspacioId: number, docListaId: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/documentacion/documentos/${id}/mover`, { docEspacioId, docListaId })
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function removeDocumento(id: number): Promise<Result> {
    try {
      const { data } = await api.delete(`/documentacion/documentos/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function ordenarDocumentos(espacioId: number, listaId: number, ids: number[]): Promise<Result> {
    try {
      const { data } = await api.patch(`/documentacion/espacios/${espacioId}/listas/${listaId}/documentos/orden`, { ids })
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  // ── Versiones ──

  async function fetchVersiones(id: number): Promise<DocumentoVersion[]> {
    try {
      const { data } = await api.get(`/documentacion/documentos/${id}/versiones`)
      return data.success ? data.data : []
    } catch { return [] }
  }

  async function restaurarVersion(id: number, versionId: number): Promise<Result> {
    try {
      const { data } = await api.post(`/documentacion/documentos/${id}/versiones/${versionId}/restaurar`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  // ── Adjuntos ──

  async function subirArchivo(file: File, documentoId?: number): Promise<Result & { archivo?: DocumentoArchivo }> {
    try {
      const form = new FormData()
      form.append('archivo', file)
      if (documentoId) form.append('documentoId', String(documentoId))
      const { data } = await api.post('/documentacion/archivos', form)
      return { ok: !!data.success, message: data.message, archivo: data.data }
    } catch (e) { return toResult(e) }
  }

  async function eliminarArchivo(id: number): Promise<Result> {
    try {
      const { data } = await api.delete(`/documentacion/archivos/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  // ── Administración de espacios ──

  async function fetchEspaciosAdmin(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/documentacion/admin/espacios')
      if (data.success) espacios.value = data.data
    } finally {
      loading.value = false
    }
  }

  async function saveEspacio(input: { nombre: string; descripcion?: string; activo?: boolean }, id?: number): Promise<Result> {
    try {
      const { data } = id
        ? await api.put(`/documentacion/admin/espacios/${id}`, input)
        : await api.post('/documentacion/admin/espacios', input)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function toggleEspacio(id: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/documentacion/admin/espacios/${id}/active`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function restoreEspacio(id: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/documentacion/admin/espacios/${id}/restore`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function removeEspacio(id: number): Promise<Result> {
    try {
      const { data } = await api.delete(`/documentacion/admin/espacios/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function fetchAccesos(espacioId: number): Promise<FilaMatrizDocEspacio[] | null> {
    try {
      const { data } = await api.get(`/documentacion/admin/espacios/${espacioId}/accesos`)
      return data.success ? data.data : null
    } catch { return null }
  }

  async function saveAccesos(espacioId: number, accesos: Array<{ userId: number; ver: boolean; editar: boolean }>): Promise<Result> {
    try {
      const { data } = await api.put(`/documentacion/admin/espacios/${espacioId}/accesos`, { accesos })
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  function reset(): void {
    espacios.value = []
    listas.value = []
    documentos.value = []
    espacioActual.value = null
    listaActual.value = null
    puedeEditar.value = false
  }

  return {
    espacios, listas, documentos, espacioActual, listaActual, puedeEditar, loading,
    fetchHome, buscar,
    fetchListas, saveLista, toggleLista, restoreLista, removeLista, ordenarListas,
    fetchDocumentos, fetchDocumento, saveDocumento, moverDocumento, removeDocumento, ordenarDocumentos,
    fetchVersiones, restaurarVersion,
    subirArchivo, eliminarArchivo,
    fetchEspaciosAdmin, saveEspacio, toggleEspacio, restoreEspacio, removeEspacio, fetchAccesos, saveAccesos,
    reset,
  }
})
