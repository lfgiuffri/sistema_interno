/**
 * Store del módulo Mantenimiento — secciones Servidores y Sitios web.
 *
 * El token del agente se devuelve UNA sola vez (al crear el servidor o al regenerarlo):
 * el backend guarda solo su hash, así que si se pierde hay que regenerarlo.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'

export interface DiscoDetalle { montaje: string; uso: number; libreGb: number }

export interface MetricaActual {
  cpu: number
  ram: number
  disco: number
  discos?: DiscoDetalle[] | null
  createdAt: string
}

export interface Servidor {
  id: number
  nombre: string
  ip: string
  activo: boolean
  monitorea: boolean
  puertoChequeo: number
  estado: 'online' | 'offline' | 'desconocido'
  ultimoContactoAt: string | null
  so: string | null
  observaciones: string | null
  umbralCpu: number | null
  umbralRam: number | null
  umbralDisco: number | null
  tieneToken: boolean
  ultima: MetricaActual | null
  incidentes: string[]
}

export interface PuntoSerie { t: string; cpu: number; ram: number; disco: number }
export interface PuntoDiario {
  fecha: string
  cpu: number; cpuMax: number
  ram: number; ramMax: number
  disco: number; discoMax: number
}
export interface Incidente {
  id: number
  tipo: 'offline' | 'cpu' | 'ram' | 'disco'
  valor: number | null
  umbral: number | null
  detalle: string | null
  resueltoAt: string | null
  createdAt: string
}

export interface ServidorDetalle extends Servidor {
  umbrales: { cpu: number; ram: number; disco: number }
  serie: PuntoSerie[]
  serieDiaria: PuntoDiario[]
  incidentes: never[] & Incidente[]
}

export interface ServidorInput {
  nombre: string
  ip: string
  activo?: boolean
  monitorea?: boolean
  puertoChequeo?: number
  umbralCpu?: number | null
  umbralRam?: number | null
  umbralDisco?: number | null
  observaciones?: string | null
}

export type EstadoSitio = 'online' | 'sin_marcador' | 'offline' | 'desconocido'
export type EstadoVence = { estado: 'ok' | 'por_vencer' | 'vencido' | 'sin_dato'; dias: number | null }

export interface SitioWeb {
  id: number
  nombre: string
  url: string
  servicioId: number | null
  servidorId: number | null
  activo: boolean
  verificaMarcador: boolean
  estado: EstadoSitio
  ultimoChequeoAt: string | null
  ultimoCodigo: number | null
  tiempoMs: number | null
  fallosSeguidos: number
  dominio: string | null
  dominioVenceAt: string | null
  dominioAuto: boolean
  dominioConsultadoAt: string | null
  tlsVenceAt: string | null
  observacion: string | null
  servicio: { id: number; nombre: string } | null
  servidor: { id: number; nombre: string } | null
  dominioEstado: EstadoVence
  tlsEstado: EstadoVence
  incidentes: string[]
  // Resumen de las vistas: el `estado` de arriba ya es el PEOR de ellas.
  vistasTotal: number
  vistasOk: number
  vistas: SitioVista[]
}

/**
 * Una URL concreta que se chequea dentro de un sitio.
 *
 * `marcadorId` en null significa «usá el global» (la config `MANTENIMIENTO_MARCADOR_ID`), no
 * «no busques marcador» — eso lo decide `verificaMarcador`.
 */
export interface SitioVista {
  id: number
  sitioId: number
  ruta: string
  nombre: string | null
  verificaMarcador: boolean
  marcadorId: string | null
  estado: EstadoSitio
  ultimoChequeoAt: string | null
  ultimoCodigo: number | null
  tiempoMs: number | null
  fallosSeguidos: number
  activo: boolean
  orden: number
}

export interface SitioVistaInput {
  ruta: string
  nombre?: string | null
  verificaMarcador?: boolean
  marcadorId?: string | null
  activo?: boolean
}

/** Un punto de la serie de velocidad (null en los períodos sin datos). */
export interface PuntoVelocidad {
  promedioMs: number | null
  muestras: number
  disponibilidad: number | null
  minMs: number | null
  maxMs: number | null
}

export interface SerieVelocidad {
  granularidad: 'dia' | 'mes' | 'anio'
  periodos: string[]
  sitio: { id: number; nombre: string; url: string }
  vistas: Array<{
    id: number
    ruta: string
    nombre: string | null
    activo: boolean
    serie: Array<PuntoVelocidad | null>
  }>
}

export interface SitioChequeo {
  id: number
  estado: 'online' | 'sin_marcador' | 'offline'
  httpStatus: number | null
  tiempoMs: number | null
  motivo: string | null
  createdAt: string
}

export interface SitioIncidente {
  id: number
  tipo: 'offline' | 'sin_marcador' | 'dominio' | 'tls'
  detalle: string | null
  resueltoAt: string | null
  createdAt: string
}

export interface SitioDetalle extends Omit<SitioWeb, 'incidentes'> {
  disponibilidad: number | null
  chequeos: SitioChequeo[]
  incidentes: SitioIncidente[]
}

export interface SitioInput {
  nombre: string
  url: string
  servicioId?: number | null
  servidorId?: number | null
  activo?: boolean
  verificaMarcador?: boolean
  dominioVenceAt?: string | null
  observacion?: string | null
}

/** Resultado de un chequeo manual (no persiste incidentes, solo informa). */
export interface ResultadoChequeo {
  estado: EstadoSitio
  httpStatus: number | null
  tiempoMs: number
  motivo: string | null
  tlsVenceAt: string | null
}

/** Resultado de una consulta RDAP a demanda. */
export interface ResultadoDominio {
  ok: boolean
  dominio?: string
  venceAt?: string | null
  motivo?: string
}

type Result = { ok: boolean; message: string; token?: string }

/** Normaliza un error de axios/negocio. */
function toResult(e: unknown): Result {
  return { ok: false, message: apiErrorMessage(e) }
}

export const useMantenimientoStore = defineStore('mantenimiento', () => {
  const servidores = ref<Servidor[]>([])
  const loading = ref(false)

  async function fetchServidores(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/mantenimiento/servidores')
      if (data.success) servidores.value = data.data
    } finally {
      loading.value = false
    }
  }

  async function fetchServidor(id: number, dias = 2): Promise<ServidorDetalle | null> {
    try {
      const { data } = await api.get(`/mantenimiento/servidores/${id}`, { params: { dias } })
      return data.success ? data.data : null
    } catch { return null }
  }

  async function save(input: ServidorInput, id?: number): Promise<Result> {
    try {
      const { data } = id
        ? await api.put(`/mantenimiento/servidores/${id}`, input)
        : await api.post('/mantenimiento/servidores', input)
      return { ok: !!data.success, message: data.message, token: data.data?.token }
    } catch (e) { return toResult(e) }
  }

  async function regenerarToken(id: number): Promise<Result> {
    try {
      const { data } = await api.post(`/mantenimiento/servidores/${id}/token`)
      return { ok: !!data.success, message: data.message, token: data.data?.token }
    } catch (e) { return toResult(e) }
  }

  async function toggle(id: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/mantenimiento/servidores/${id}/active`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function remove(id: number): Promise<Result> {
    try {
      const { data } = await api.delete(`/mantenimiento/servidores/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  // ───────────────────────────── Sitios web ─────────────────────────────

  const sitios = ref<SitioWeb[]>([])
  const loadingSitios = ref(false)

  async function fetchSitios(): Promise<void> {
    loadingSitios.value = true
    try {
      const { data } = await api.get('/mantenimiento/sitios')
      if (data.success) sitios.value = data.data
    } finally {
      loadingSitios.value = false
    }
  }

  async function fetchSitio(id: number): Promise<SitioDetalle | null> {
    try {
      const { data } = await api.get(`/mantenimiento/sitios/${id}`)
      return data.success ? data.data : null
    } catch { return null }
  }

  async function saveSitio(input: SitioInput, id?: number): Promise<Result> {
    try {
      const { data } = id
        ? await api.put(`/mantenimiento/sitios/${id}`, input)
        : await api.post('/mantenimiento/sitios', input)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  /** Chequeo manual: no espera al tick de 5 minutos. */
  async function chequearSitio(id: number): Promise<ResultadoChequeo | null> {
    try {
      const { data } = await api.post(`/mantenimiento/sitios/${id}/chequear`)
      return data.success ? data.data : null
    } catch { return null }
  }

  /** Consulta RDAP a demanda del vencimiento del dominio. */
  async function consultarDominio(id: number): Promise<ResultadoDominio | null> {
    try {
      const { data } = await api.post(`/mantenimiento/sitios/${id}/dominio`)
      return data.success ? data.data : null
    } catch { return null }
  }

  async function toggleSitio(id: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/mantenimiento/sitios/${id}/active`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function removeSitio(id: number): Promise<Result> {
    try {
      const { data } = await api.delete(`/mantenimiento/sitios/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  /* ─────────────────────── Vistas de un sitio ─────────────────────── */

  async function fetchVistas(sitioId: number): Promise<SitioVista[]> {
    try {
      const { data } = await api.get(`/mantenimiento/sitios/${sitioId}/vistas`)
      return data.success ? (data.data as SitioVista[]) : []
    } catch { return [] }
  }

  /** Alta (sin `id`) o edición (con `id`) de una vista. */
  async function saveVista(sitioId: number, input: SitioVistaInput, id?: number): Promise<Result> {
    try {
      const { data } = id
        ? await api.put(`/mantenimiento/sitios/vistas/${id}`, input)
        : await api.post(`/mantenimiento/sitios/${sitioId}/vistas`, input)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function toggleVista(id: number): Promise<Result> {
    try {
      const { data } = await api.patch(`/mantenimiento/sitios/vistas/${id}/active`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  async function removeVista(id: number): Promise<Result> {
    try {
      const { data } = await api.delete(`/mantenimiento/sitios/vistas/${id}`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  /* ─────────────────────────── Velocidad ─────────────────────────── */

  async function fetchVelocidad(sitioId: number, granularidad = 'dia', vistaId?: number): Promise<SerieVelocidad | null> {
    try {
      const { data } = await api.get(`/mantenimiento/sitios/${sitioId}/velocidad`, {
        params: { granularidad, vistaId: vistaId || undefined },
      })
      return data.success ? (data.data as SerieVelocidad) : null
    } catch { return null }
  }

  function reset(): void {
    servidores.value = []
    sitios.value = []
  }

  return {
    servidores, loading, fetchServidores, fetchServidor, save, regenerarToken, toggle, remove,
    sitios, loadingSitios, fetchSitios, fetchSitio, saveSitio, chequearSitio, consultarDominio,
    toggleSitio, removeSitio,
    fetchVistas, saveVista, toggleVista, removeVista, fetchVelocidad,
    reset
  }
})
