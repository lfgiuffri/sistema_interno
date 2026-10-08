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
  /** Qué alertas crea este servidor (el umbral corre la línea; esto apaga el aviso). */
  alertaOffline: boolean
  alertaCpu: boolean
  alertaRam: boolean
  alertaDisco: boolean
  tieneToken: boolean
  /** Si este VPS aloja FullGlass: habilita SQL masivo y deploy. */
  tieneFullglass: boolean
  rutaSitios: string
  comandoDeployProd: string | null
  comandoDeployDev: string | null
  /** Clave del config_site.php donde cada cliente declara su rama. */
  claveRama: string
  comandoCambiarRama: string | null
  /** Última vez que el agente reportó su inventario. null = nunca habló. */
  sitiosReportadosAt: string | null
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

/** Un sitio de cliente tal como lo reportó el agente (nunca credenciales). */
export interface SitioServidor {
  id: number
  ruta: string
  base: string | null
  problema: string | null
  ultimoReporteAt: string
}

/** Análisis de riesgo de un SQL. */
export interface AnalisisSql {
  sentencias: string[]
  peligros: Array<{ que: string; sentencia: string }>
}

/** Resultado de un trabajo en UNA base. */
export interface TrabajoResultado {
  id: number
  sitio: string
  base: string | null
  estado: 'ok' | 'error' | 'omitido'
  esCanario: boolean
  filasAfectadas: number | null
  sentenciasOk: number | null
  error: string | null
  ms: number | null
}

/** Una ejecución (SQL o deploy) en un servidor. */
export interface Trabajo {
  id: number
  loteId: string
  servidorId: number
  tipo: 'sql' | 'deploy' | 'rama'
  estado: 'pendiente' | 'canario' | 'espera_ok' | 'aprobado' | 'corriendo' | 'ok' | 'error' | 'cancelado'
  sql: string | null
  comando: string | null
  entorno: 'produccion' | 'desarrollo' | null
  /** Rama destino. En una DETECCIÓN va null: es lo que el trabajo va a averiguar. */
  rama: string | null
  /** Carpetas elegidas. En un cambio de rama es una sola: el cliente que se mueve. */
  sitios: string[] | null
  salida: string | null
  error: string | null
  createdAt: string
  tomadoAt: string | null
  finalizadoAt: string | null
  servidore?: { id: number; nombre: string } | null
  user?: { id: number; name: string; lastName: string } | null
  resultados?: TrabajoResultado[]
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
  alertaOffline?: boolean
  alertaCpu?: boolean
  alertaRam?: boolean
  alertaDisco?: boolean
  observaciones?: string | null
  /** Si aloja FullGlass. Habilita SQL masivo y deploy; por sí solo no permite ejecutar nada. */
  tieneFullglass?: boolean
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
  /** Si este sitio corre FullGlass. Los viejos que no lo usan quedan afuera de todo esto. */
  usaFullglass: boolean
  /** Carpeta del cliente en su servidor, el puente con lo que ve el agente. */
  rutaFullglass: string | null
  /** Rama LEÍDA del servidor por el agente (no guardada acá). null si no se pudo cruzar. */
  rama: string | null
  /** ¿El agente VIO esta carpeta? Separa «falta configurar algo» de «el cliente no declara
   *  su rama», que es lo que se arregla desde la pantalla sin entrar al servidor. */
  rutaInventariada: boolean
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
  usaFullglass?: boolean
  rutaFullglass?: string | null
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

  // ── FullGlass: SQL masivo y deploy ──────────────────────────────────────────────────

  /** Sitios (bases de clientes) que el agente reportó: alimenta la vista previa. */
  async function fetchSitiosServidor(id: number): Promise<SitioServidor[]> {
    const { data } = await api.get(`/mantenimiento/servidores/${id}/sitios`).catch(() => ({ data: { success: false } }))
    return data.success ? data.data : []
  }

  /** Guarda la ruta que recorre el agente (`servidores:bd-config`). */
  async function guardarConfigBd(id: number, rutaSitios: string, claveRama?: string): Promise<Result> {
    try {
      const { data } = await api.put(`/mantenimiento/servidores/${id}/config-bd`, { rutaSitios, claveRama })
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  /** Guarda los comandos de deploy (`servidores:deploy-config`). */
  async function guardarConfigDeploy(
    id: number,
    comandos: {
      comandoDeployProd?: string | null
      comandoDeployDev?: string | null
      comandoCambiarRama?: string | null
    },
  ): Promise<Result> {
    try {
      const { data } = await api.put(`/mantenimiento/servidores/${id}/config-deploy`, comandos)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  /** Qué tiene de peligroso un SQL, ANTES de lanzarlo. No ejecuta nada. */
  async function analizarSql(sql: string): Promise<AnalisisSql | null> {
    const { data } = await api.post('/mantenimiento/trabajos/analizar', { sql }).catch(() => ({ data: { success: false } }))
    return data.success ? data.data : null
  }

  /** Lanza un lote: un trabajo por servidor elegido. */
  async function lanzarTrabajos(payload: Record<string, unknown>): Promise<Result & { trabajos?: Trabajo[] }> {
    try {
      const { data } = await api.post('/mantenimiento/trabajos', payload)
      return { ok: !!data.success, message: data.message, trabajos: data.data?.trabajos }
    } catch (e) { return toResult(e) }
  }

  /** Historial de ejecuciones. */
  async function fetchTrabajos(filtros: Record<string, unknown> = {}): Promise<Trabajo[]> {
    const { data } = await api.get('/mantenimiento/trabajos', { params: filtros }).catch(() => ({ data: { success: false } }))
    return data.success ? data.data : []
  }

  /** Un trabajo con el detalle base por base. */
  async function fetchTrabajo(id: number): Promise<Trabajo | null> {
    const { data } = await api.get(`/mantenimiento/trabajos/${id}`).catch(() => ({ data: { success: false } }))
    return data.success ? data.data : null
  }

  /** Da el OK para seguir con el resto de las bases después de un canario. */
  async function aprobarTrabajo(id: number): Promise<Result> {
    try {
      const { data } = await api.post(`/mantenimiento/trabajos/${id}/aprobar`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  /** Cancela lo que el agente no tomó, o destraba un huérfano. */
  async function cancelarTrabajo(id: number): Promise<Result> {
    try {
      const { data } = await api.post(`/mantenimiento/trabajos/${id}/cancelar`)
      return { ok: !!data.success, message: data.message }
    } catch (e) { return toResult(e) }
  }

  return {
    servidores, loading, fetchServidores, fetchServidor, save, regenerarToken, toggle, remove,
    fetchSitiosServidor, guardarConfigBd, guardarConfigDeploy,
    analizarSql, lanzarTrabajos, fetchTrabajos, fetchTrabajo, aprobarTrabajo, cancelarTrabajo,
    sitios, loadingSitios, fetchSitios, fetchSitio, saveSitio, chequearSitio, consultarDominio,
    toggleSitio, removeSitio,
    fetchVistas, saveVista, toggleVista, removeVista, fetchVelocidad,
    reset
  }
})
