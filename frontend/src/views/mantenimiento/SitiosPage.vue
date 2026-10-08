<script setup lang="ts">
/**
 * Sitios web: disponibilidad, vencimiento de dominio y de certificado.
 *
 * El estado sale del chequeo automático cada 5 minutos, que busca el marcador
 * `<div id="app-conn-id">` del footer: por eso hay un estado intermedio («responde pero no es
 * nuestro sitio») que un ping común no distinguiría. Desde acá se puede forzar un chequeo o
 * una consulta de dominio sin esperar al próximo ciclo.
 */
import { ref, computed, onMounted } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  addOutline, createOutline, trashOutline, powerOutline, globeOutline,
  refreshOutline, openOutline, alertCircleOutline, calendarOutline, timeOutline,
  searchOutline, closeOutline, speedometerOutline, layersOutline,
} from 'ionicons/icons'
import api from '@/services/api'
import {
  useMantenimientoStore,
  type SitioWeb, type SitioInput, type SitioDetalle, type EstadoVence,
} from '@/stores/mantenimiento'
import ThOrdenable from '@/components/shared/ThOrdenable.vue'
import VistasSitioModal from '@/components/mantenimiento/VistasSitioModal.vue'
import VelocidadSitioModal from '@/components/mantenimiento/VelocidadSitioModal.vue'
import { useOrdenTabla } from '@/composables/useOrdenTabla'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fechaHora, fecha as fmtFecha } from '@/composables/useFormato'

const store = useMantenimientoStore()
const meStore = useMeStore()
const toast = useToast()

interface Opcion { value: number; label: string }
const servicios = ref<Opcion[]>([])
const servidores = ref<Opcion[]>([])

const modalForm = ref(false)
const editando = ref<SitioWeb | null>(null)
const form = ref<SitioInput>({ nombre: '', url: '' })
const formError = ref('')
useEscapeToClose(modalForm, () => { modalForm.value = false })

const modalDetalle = ref(false)
const detalle = ref<SitioDetalle | null>(null)
useEscapeToClose(modalDetalle, () => { modalDetalle.value = false })

/** Sitio con un chequeo manual en curso (para deshabilitar el botón). */
const chequeando = ref<number | null>(null)

/** Sitio cuyas vistas se están administrando (null = modal cerrado). */
const sitioVistas = ref<SitioWeb | null>(null)
/** Sitio cuya velocidad se está mirando. */
const sitioVelocidad = ref<SitioWeb | null>(null)

function abrirVistas(s: SitioWeb): void { sitioVistas.value = s }
function abrirVelocidad(s: SitioWeb): void { sitioVelocidad.value = s }

/** Las vistas cambiaron: el estado y el resumen de la fila salen de ellas. */
async function vistasCambiaron(): Promise<void> { await store.fetchSitios() }

/**
 * Buscador por nombre O URL.
 *
 * Filtra en el cliente y no en el servidor a propósito: el listado no está paginado (son
 * decenas de sitios, no miles), así que ya están todos en memoria. Filtrar acá es instantáneo
 * y no agrega un pedido por cada tecla.
 */
const busqueda = ref('')

/**
 * Normaliza para comparar: sin mayúsculas y sin acentos («araujo» encuentra «Araújo»).
 * NFD separa la letra de su tilde, y el rango U+0300–U+036F (las tildes sueltas) se borra.
 */
const normalizar = (s: string): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * Filtros de la barra. Se aplican en el cliente por el mismo motivo que el buscador: el
 * listado no pagina y ya trae los estados DERIVADOS (dominio y certificado se calculan en
 * cada consulta, no se guardan). Filtrarlos en SQL obligaría a repetir ese cálculo allá.
 */
const fEstado = ref('')      // online | sin_marcador | offline | desconocido
const fServicio = ref('')    // id de servicio, o 'sin'
const fServidor = ref('')    // id de servidor, o 'sin'
const fActivo = ref('')      // si | no
const fVence = ref('')       // dominio_por_vencer | dominio_vencido | tls_* | cualquiera
const fIncidentes = ref(false)
const fNuestros = ref('')    // si | no  («es un sitio nuestro» = verifica el marcador)
// Rama: el valor crudo que reportó el agente (main, development, o el que sea), más dos que no
// son una rama pero son justo lo que se busca cuando algo no cuadra: 'sin' = usa FullGlass y
// no se sabe en qué rama está, 'nofg' = ni siquiera usa FullGlass.
const fRama = ref('')

/** ¿Hay algún filtro puesto (además del buscador)? */
const hayFiltros = computed(() =>
  !!(fEstado.value || fServicio.value || fServidor.value || fActivo.value || fVence.value
    || fNuestros.value || fRama.value) || fIncidentes.value,
)

function limpiarFiltros(): void {
  fEstado.value = ''; fServicio.value = ''; fServidor.value = ''
  fActivo.value = ''; fVence.value = ''; fNuestros.value = ''; fRama.value = ''
  fIncidentes.value = false
}

/**
 * Las ramas del selector salen de los DATOS y no de una lista fija: la rama la
 * lee el agente de `config_site.php`, así que un cliente puede estar en una rama de prueba con
 * cualquier nombre. Con la lista fija ese sitio no se podría filtrar justo cuando interesa.
 */
const ramasDisponibles = computed<string[]>(() =>
  [...new Set(store.sitios.filter(s => s.usaFullglass && s.rama).map(s => s.rama as string))].sort(),
)

/** ¿El sitio cae en el filtro de vencimientos elegido? */
function pasaVencimiento(s: SitioWeb): boolean {
  const v = fVence.value
  if (!v) return true
  const d = s.dominioEstado?.estado
  const c = s.tlsEstado?.estado
  if (v === 'dominio_por_vencer') return d === 'por_vencer'
  if (v === 'dominio_vencido') return d === 'vencido'
  if (v === 'tls_por_vencer') return c === 'por_vencer'
  if (v === 'tls_vencido') return c === 'vencido'
  // «Algo por vencer o vencido»: la vista de un solo golpe de todo lo que pide atención.
  return ['por_vencer', 'vencido'].includes(d ?? '') || ['por_vencer', 'vencido'].includes(c ?? '')
}

const sitiosFiltrados = computed<SitioWeb[]>(() => {
  const q = normalizar(busqueda.value.trim())
  // Cada palabra tiene que aparecer en el nombre o en la URL: así «tio com» encuentra
  // «Tio - Tom» sin depender del orden ni de los separadores.
  const palabras = q ? q.split(/\s+/) : []

  return store.sitios.filter((s) => {
    if (palabras.length) {
      const texto = `${normalizar(s.nombre)} ${normalizar(s.url)}`
      if (!palabras.every(p => texto.includes(p))) return false
    }
    if (fEstado.value && s.estado !== fEstado.value) return false
    if (fActivo.value && s.activo !== (fActivo.value === 'si')) return false
    if (fIncidentes.value && !s.incidentes.length) return false
    // «Nuestro» = le exigimos el marcador del footer. Los de terceros no lo tienen y por eso
    // se chequean solo por 2xx: es la misma bandera vista desde el otro lado.
    if (fNuestros.value && s.verificaMarcador !== (fNuestros.value === 'si')) return false
    if (fRama.value === 'nofg' && s.usaFullglass) return false
    if (fRama.value === 'sin' && (!s.usaFullglass || s.rama)) return false
    if (fRama.value && !['sin', 'nofg'].includes(fRama.value) && s.rama !== fRama.value) return false
    if (fServicio.value === 'sin' && s.servicioId) return false
    if (fServicio.value && fServicio.value !== 'sin' && s.servicioId !== Number(fServicio.value)) return false
    if (fServidor.value === 'sin' && s.servidorId) return false
    if (fServidor.value && fServidor.value !== 'sin' && s.servidorId !== Number(fServidor.value)) return false
    return pasaVencimiento(s)
  })
})

/** Etiqueta legible del estado de disponibilidad. */
const ETIQUETA: Record<string, string> = {
  online: 'En línea',
  sin_marcador: 'Sin marcador',
  offline: 'Caído',
  desconocido: 'Sin chequear',
}

/** Color del punto de estado. */
function colorEstado(e: string): string {
  if (e === 'online') return 'bg-ok'
  if (e === 'offline') return 'bg-danger'
  if (e === 'sin_marcador') return 'bg-warn'
  return 'bg-ink-faint'
}

/** Clase del texto de un vencimiento según cuán cerca está. */
function claseVence(v: EstadoVence): string {
  if (v.estado === 'vencido') return 'text-danger font-semibold'
  if (v.estado === 'por_vencer') return 'text-warn font-medium'
  return 'text-ink'
}

/** Texto corto de un vencimiento («12/11/26 · 90 días»). */
function textoVence(fechaISO: string | null, v: EstadoVence): string {
  if (!fechaISO) return '—'
  if (v.estado === 'vencido') return `${fmtFecha(fechaISO)} · vencido`
  return `${fmtFecha(fechaISO)} · ${v.dias} d`
}

// Se ordena lo YA filtrado: el buscador acota y el encabezado ordena ese resultado.
const orden = useOrdenTabla(() => sitiosFiltrados.value)

/* ── Rama de FullGlass ───────────────────────────────────────────────────────────────
 *
 * La rama que se muestra la LEE el agente del servidor; acá no se guarda nada. Cambiarla es
 * lanzar un trabajo con el script que el equipo dejó en ese servidor, así que pasa por la
 * misma maquinaria que el SQL masivo y el deploy: historial, permisos y captura de errores.
 */
/**
 * Las dos ramas entre las que se alterna. Van como constantes y no como literales sueltos
 * porque el nombre se manda TAL CUAL al script que cambia la rama en el servidor: un literal
 * repetido en cuatro lugares es la forma segura de que uno quede viejo y mande al cliente a
 * una rama que no existe. En los servidores la de pruebas se llama `development`, no `dev`.
 */
const RAMA_ESTABLE = 'main'
const RAMA_PRUEBAS = 'development'

const puedeCambiarRama = computed(() => meStore.can('servidores:deploy-ejecutar'))
const sitioRama = ref<SitioWeb | null>(null)
const ramaDestino = ref(RAMA_ESTABLE)
const cambiandoRama = ref(false)
const errorRama = ref('')

/**
 * Por qué un sitio de FullGlass puede no tener rama. Son TRES causas y se arreglan distinto:
 * las dos primeras faltan cargar acá, la tercera se resuelve sola desde esta misma pantalla.
 */
function sinRama(s: SitioWeb): string {
  if (!s.servidorId) return 'Falta asociarle un servidor al sitio'
  if (!s.rutaFullglass) return 'Falta la carpeta del cliente en el servidor'
  if (!s.rutaInventariada) return 'El agente de ese servidor todavía no reportó esta carpeta'
  return 'El config_site.php de este cliente no declara la rama. Se puede averiguar y dejar declarada desde acá.'
}

/**
 * ¿Se le puede pedir al servidor que averigüe la rama?
 *
 * Hace falta el servidor y la carpeta —sin eso no hay a quién ni dónde mirar—, pero NO que el
 * agente ya la haya reportado: si la carpeta está mal cargada, lanzar la detección es
 * justamente lo que lo dice, con el error del script en el historial.
 */
function sePuedeDetectar(s: SitioWeb): boolean {
  return !!(s.usaFullglass && !s.rama && s.servidorId && s.rutaFullglass && puedeCambiarRama.value)
}

function abrirRama(s: SitioWeb): void {
  sitioRama.value = s
  // Se propone la CONTRARIA, que es lo que casi siempre se quiere, pero se manda explícita:
  // el backend nunca alterna por su cuenta.
  ramaDestino.value = s.rama === RAMA_ESTABLE ? RAMA_PRUEBAS : RAMA_ESTABLE
  errorRama.value = ''
}

/* ── Detectar la rama de un cliente viejo ────────────────────────────────────────────
 *
 * Los clientes de antes no tienen la key `branch` en su `config_site.php`, así que el agente
 * no tiene de dónde leerla y la columna queda vacía. Esto lanza el mismo script, con
 * `--detectar`: mira a qué carpeta de FullGlass apuntan los archivos del cliente, deduce la
 * rama y la deja declarada. NO lo mueve de rama — por eso es seguro ofrecerlo acá.
 */
const sitioDetectar = ref<SitioWeb | null>(null)
const detectando = ref(false)
const errorDetectar = ref('')

function abrirDetectar(s: SitioWeb): void {
  sitioDetectar.value = s
  errorDetectar.value = ''
}

async function confirmarDetectar(): Promise<void> {
  const s = sitioDetectar.value
  if (!s || !s.servidorId || !s.rutaFullglass) return
  detectando.value = true
  errorDetectar.value = ''
  const r = await store.lanzarTrabajos({
    tipo: 'rama',
    detectar: true,
    servidorIds: [s.servidorId],
    sitios: [s.rutaFullglass],
  })
  detectando.value = false
  if (!r.ok) { errorDetectar.value = r.message; return }
  toast.success('Detección lanzada: el agente la corre en unos segundos y la rama aparece sola')
  sitioDetectar.value = null
}

async function confirmarRama(): Promise<void> {
  const s = sitioRama.value
  if (!s || !s.servidorId || !s.rutaFullglass) return
  cambiandoRama.value = true
  errorRama.value = ''
  const r = await store.lanzarTrabajos({
    tipo: 'rama',
    servidorIds: [s.servidorId],
    rama: ramaDestino.value,
    sitios: [s.rutaFullglass],
  })
  cambiandoRama.value = false
  if (!r.ok) { errorRama.value = r.message; return }
  toast.success(`Cambio a ${ramaDestino.value} lanzado: el agente lo toma en unos segundos`)
  sitioRama.value = null
}

const hayIncidentes = computed(() => store.sitios.some(s => s.incidentes.length))

async function cargarOpciones(): Promise<void> {
  const [sv, sr] = await Promise.all([
    api.get('/servicios', { params: { limit: 200 } }).catch(() => null),
    api.get('/mantenimiento/servidores').catch(() => null),
  ])
  if (sv?.data.success) servicios.value = sv.data.data.map((o: { id: number; nombre: string }) => ({ value: o.id, label: o.nombre }))
  if (sr?.data.success) servidores.value = sr.data.data.map((o: { id: number; nombre: string }) => ({ value: o.id, label: o.nombre }))
}

function abrirForm(s?: SitioWeb): void {
  editando.value = s ?? null
  form.value = s
    ? {
      nombre: s.nombre, url: s.url, servicioId: s.servicioId, servidorId: s.servidorId,
      verificaMarcador: s.verificaMarcador, dominioVenceAt: s.dominioVenceAt, observacion: s.observacion,
      usaFullglass: s.usaFullglass, rutaFullglass: s.rutaFullglass,
    }
    : { nombre: '', url: 'https://', verificaMarcador: true, usaFullglass: false, rutaFullglass: null }
  formError.value = ''
  modalForm.value = true
}

async function guardar(): Promise<void> {
  formError.value = ''
  const r = await store.saveSitio({ ...form.value }, editando.value?.id)
  if (!r.ok) { formError.value = r.message; return }
  modalForm.value = false
  toast.success(editando.value ? 'Sitio actualizado' : 'Sitio creado')
  await store.fetchSitios()
}

async function chequear(s: SitioWeb): Promise<void> {
  chequeando.value = s.id
  try {
    const r = await store.chequearSitio(s.id)
    if (!r) { toast.error('No se pudo chequear el sitio'); return }
    if (r.estado === 'online') toast.success(`${s.nombre} responde bien (${r.tiempoMs} ms)`)
    else toast.error(r.motivo ?? 'El sitio no responde')
    await store.fetchSitios()
  } finally {
    chequeando.value = null
  }
}

async function consultarDominio(s: SitioWeb): Promise<void> {
  const r = await store.consultarDominio(s.id)
  if (!r) { toast.error('No se pudo consultar el dominio'); return }
  if (r.ok && r.venceAt) toast.success(`${r.dominio} vence el ${fmtFecha(r.venceAt)}`)
  else toast.error(r.motivo ?? 'No se pudo obtener la fecha')
  await store.fetchSitios()
}

async function verDetalle(s: SitioWeb): Promise<void> {
  detalle.value = await store.fetchSitio(s.id)
  if (detalle.value) modalDetalle.value = true
}

async function toggle(s: SitioWeb): Promise<void> {
  const r = await store.toggleSitio(s.id)
  if (!r.ok) { toast.error(r.message); return }
  await store.fetchSitios()
}

async function eliminar(s: SitioWeb): Promise<void> {
  if (!confirm(`¿Eliminar el sitio «${s.nombre}»? Se borra también su historial de chequeos.`)) return
  const r = await store.removeSitio(s.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Sitio eliminado')
  await store.fetchSitios()
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void store.fetchSitios(); void cargarOpciones() })
onIonViewWillEnter(() => { if (loadedOnce) void store.fetchSitios() })
</script>

<template>
  <IonPage>
    <IonHeader class="ion-no-border">
      <IonToolbar class="app-toolbar">
        <IonButtons slot="start" class="lg:hidden"><IonMenuButton /></IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent class="page-content">
      <div class="max-w-6xl mx-auto px-5 lg:px-8 py-6 ds-enter">

        <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Sitios web</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              Se chequean cada 5 minutos. Los dominios se consultan una vez por día.
            </p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <!-- Buscador: un solo campo que mira nombre y URL. -->
            <div class="relative">
              <IonIcon :icon="searchOutline" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint pointer-events-none" />
              <input
                v-model="busqueda"
                class="ds-input h-9 w-56 pl-8 pr-8"
                type="search"
                placeholder="Buscar por nombre o URL"
                aria-label="Buscar por nombre o URL"
                @keydown.esc="busqueda = ''"
              />
              <button
                v-if="busqueda"
                class="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-5 h-5 rounded text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
                title="Limpiar" aria-label="Limpiar la búsqueda"
                @click="busqueda = ''"
              >
                <IonIcon :icon="closeOutline" class="text-[14px]" />
              </button>
            </div>
            <button v-if="meStore.can('sitios:create')" class="ds-btn-primary flex items-center gap-1.5 shrink-0" @click="abrirForm()">
              <IonIcon :icon="addOutline" class="text-[16px]" /> Nuevo sitio
            </button>
          </div>
        </header>

        <!--
          Barra de filtros. `flex-wrap` obligatorio: son ocho controles y en celular tienen
          que bajar de renglón en vez de comprimirse (ver docs/responsive.md).
        -->
        <div class="ds-card px-3 py-2.5 mb-3 flex flex-wrap items-center gap-2">
          <select v-model="fEstado" class="ds-input h-8 w-auto text-xs" aria-label="Filtrar por disponibilidad">
            <option value="">Disponibilidad: todas</option>
            <option value="online">En línea</option>
            <option value="sin_marcador">Sin marcador</option>
            <option value="offline">Caídos</option>
            <option value="desconocido">Sin chequear</option>
          </select>

          <select v-model="fVence" class="ds-input h-8 w-auto text-xs" aria-label="Filtrar por vencimientos">
            <option value="">Vencimientos: todos</option>
            <option value="cualquiera">Algo por vencer o vencido</option>
            <option value="dominio_por_vencer">Dominio por vencer</option>
            <option value="dominio_vencido">Dominio vencido</option>
            <option value="tls_por_vencer">Certificado por vencer</option>
            <option value="tls_vencido">Certificado vencido</option>
          </select>

          <select v-model="fServicio" class="ds-input h-8 w-auto text-xs" aria-label="Filtrar por servicio">
            <option value="">Servicio: todos</option>
            <option value="sin">Sin servicio</option>
            <option v-for="o in servicios" :key="o.value" :value="String(o.value)">{{ o.label }}</option>
          </select>

          <select v-model="fServidor" class="ds-input h-8 w-auto text-xs" aria-label="Filtrar por servidor">
            <option value="">Servidor: todos</option>
            <option value="sin">Sin servidor</option>
            <option v-for="o in servidores" :key="o.value" :value="String(o.value)">{{ o.label }}</option>
          </select>

          <select v-model="fActivo" class="ds-input h-8 w-auto text-xs" aria-label="Filtrar por estado del sitio">
            <option value="">Activos e inactivos</option>
            <option value="si">Solo activos</option>
            <option value="no">Solo inactivos</option>
          </select>

          <select v-model="fNuestros" class="ds-input h-8 w-auto text-xs" aria-label="Filtrar por sitios propios">
            <option value="">Propios y de terceros</option>
            <option value="si">Solo nuestros</option>
            <option value="no">Solo de terceros</option>
          </select>

          <select v-model="fRama" class="ds-input h-8 w-auto text-xs" aria-label="Filtrar por rama">
            <option value="">Rama: todas</option>
            <option v-for="r in ramasDisponibles" :key="r" :value="r">{{ r }}</option>
            <option value="sin">Sin rama informada</option>
            <option value="nofg">No usa FullGlass</option>
          </select>

          <label class="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer select-none">
            <input v-model="fIncidentes" type="checkbox" class="accent-accent" />
            Con incidentes abiertos
          </label>

          <button v-if="hayFiltros" class="ds-btn-ghost h-8 text-xs ml-auto" @click="limpiarFiltros">
            <IonIcon :icon="closeOutline" class="text-[13px]" /> Limpiar filtros
          </button>
        </div>

        <div v-if="store.loadingSitios && !store.sitios.length" class="space-y-2">
          <div v-for="i in 3" :key="i" class="ds-skeleton h-16"></div>
        </div>

        <div v-else-if="sitiosFiltrados.length" class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <ThOrdenable columna="nombre" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Sitio</ThOrdenable>
                <ThOrdenable columna="estado" :activa="orden.columna.value" :dir="orden.dir.value" class="w-32" @ordenar="orden.ordenarPor">Estado</ThOrdenable>
                <ThOrdenable columna="rama" :activa="orden.columna.value" :dir="orden.dir.value" class="w-28" @ordenar="orden.ordenarPor">Rama</ThOrdenable>
                <ThOrdenable columna="dominioVenceAt" :activa="orden.columna.value" :dir="orden.dir.value" class="w-36" @ordenar="orden.ordenarPor">Dominio</ThOrdenable>
                <ThOrdenable columna="tlsVenceAt" :activa="orden.columna.value" :dir="orden.dir.value" class="w-36" @ordenar="orden.ordenarPor">Certificado</ThOrdenable>
                <ThOrdenable columna="ultimoChequeoAt" :activa="orden.columna.value" :dir="orden.dir.value" class="w-32" @ordenar="orden.ordenarPor">Último chequeo</ThOrdenable>
                <th class="w-32"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in orden.ordenadas.value" :key="s.id" :class="{ 'opacity-50': !s.activo }">
                <td>
                  <button class="text-left group" @click="verDetalle(s)">
                    <div class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full shrink-0" :class="colorEstado(s.estado)" :title="ETIQUETA[s.estado]"></span>
                      <span class="font-medium text-ink group-hover:text-accent transition-colors">{{ s.nombre }}</span>
                      <span v-if="s.servicio" class="ds-badge-neutral">{{ s.servicio.nombre }}</span>
                      <span v-if="s.incidentes.length" class="ds-badge-danger">
                        <IonIcon :icon="alertCircleOutline" class="text-[11px]" />
                        {{ s.incidentes.length }}
                      </span>
                    </div>
                    <p class="text-2xs text-ink-faint font-mono truncate max-w-[320px]">
                      {{ s.url }}<span v-if="s.servidor"> · {{ s.servidor.nombre }}</span>
                    </p>
                  </button>
                </td>
                <td>
                  <span class="text-xs" :class="s.estado === 'online' ? 'text-ink' : s.estado === 'desconocido' ? 'text-ink-faint' : 'text-danger font-medium'">
                    {{ ETIQUETA[s.estado] }}
                  </span>
                  <p v-if="s.tiempoMs && s.estado !== 'desconocido'" class="text-2xs text-ink-faint tnum">{{ s.tiempoMs }} ms</p>
                  <!--
                    Resumen de vistas. Solo se muestra si hay MÁS DE UNA: en el caso normal
                    —un sitio, una URL— «1 de 1 vista» sería ruido que no informa nada.
                  -->
                  <button
                    v-if="s.vistasTotal > 1"
                    class="text-2xs tnum hover:underline"
                    :class="s.vistasOk === s.vistasTotal ? 'text-ink-faint' : 'text-danger font-medium'"
                    :title="`Ver las ${s.vistasTotal} vistas de ${s.nombre}`"
                    @click.stop="abrirVistas(s)"
                  >
                    {{ s.vistasOk }} de {{ s.vistasTotal }} vistas OK
                  </button>
                </td>
                <!-- La rama NO está guardada acá: la reporta el agente leyéndola del servidor.
                     Por eso un sitio de FullGlass sin dato significa «todavía no se pudo cruzar»
                     (falta la carpeta, o el agente no reportó), y se dice así. -->
                <td class="text-xs">
                  <button
                    v-if="s.usaFullglass && s.rama"
                    type="button"
                    class="ds-pill"
                    :class="{ 'ds-pill-activa': true }"
                    :style="{ '--c': s.rama === RAMA_ESTABLE ? '#0F7660' : '#b45309' }"
                    :disabled="!puedeCambiarRama"
                    :title="puedeCambiarRama ? 'Cambiar de rama' : 'Sin permiso para cambiar la rama'"
                    @click="abrirRama(s)"
                  >{{ s.rama }}</button>
                  <!-- Cuando se puede resolver, «sin dato» es un BOTÓN. Antes era un texto
                       muerto cuya única explicación vivía en un title que había que ir a
                       buscar con el mouse, sitio por sitio. -->
                  <button
                    v-else-if="s.usaFullglass && sePuedeDetectar(s)"
                    type="button"
                    class="text-2xs text-accent hover:underline text-left"
                    :title="sinRama(s)"
                    @click="abrirDetectar(s)"
                  >sin dato · detectar</button>
                  <span v-else-if="s.usaFullglass" class="text-2xs text-ink-faint" :title="sinRama(s)">
                    sin dato
                  </span>
                  <span v-else class="text-2xs text-ink-faint">—</span>
                </td>
                <td class="text-xs tnum" :class="claseVence(s.dominioEstado)">
                  {{ textoVence(s.dominioVenceAt, s.dominioEstado) }}
                  <p v-if="!s.dominioVenceAt" class="text-2xs text-ink-faint">sin fecha</p>
                </td>
                <td class="text-xs tnum" :class="claseVence(s.tlsEstado)">
                  {{ textoVence(s.tlsVenceAt, s.tlsEstado) }}
                </td>
                <td class="text-2xs text-ink-faint tnum">
                  {{ s.ultimoChequeoAt ? fechaHora(s.ultimoChequeoAt) : 'nunca' }}
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <a class="row-action" :href="s.url" target="_blank" rel="noopener" title="Abrir el sitio" aria-label="Abrir el sitio">
                      <IonIcon :icon="openOutline" class="text-[15px]" />
                    </a>
                    <button
                      v-if="meStore.can('sitios:update')" class="row-action" :disabled="chequeando === s.id"
                      title="Chequear ahora" aria-label="Chequear ahora" @click="chequear(s)"
                    >
                      <IonIcon :icon="refreshOutline" class="text-[15px]" :class="{ 'animate-spin': chequeando === s.id }" />
                    </button>
                    <button v-if="meStore.can('sitios:update')" class="row-action" title="Consultar el vencimiento del dominio" aria-label="Consultar dominio" @click="consultarDominio(s)">
                      <IonIcon :icon="calendarOutline" class="text-[15px]" />
                    </button>
                    <button class="row-action" title="Velocidad del sitio" aria-label="Velocidad del sitio" @click="abrirVelocidad(s)">
                      <IonIcon :icon="speedometerOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('sitios:update')" class="row-action" title="Vistas que se chequean" aria-label="Vistas que se chequean" @click="abrirVistas(s)">
                      <IonIcon :icon="layersOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('sitios:update')" class="row-action" title="Editar" aria-label="Editar" @click="abrirForm(s)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('sitios:toggle')" class="row-action" :title="s.activo ? 'Desactivar' : 'Activar'" aria-label="Activar o desactivar" @click="toggle(s)">
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('sitios:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="eliminar(s)">
                      <IonIcon :icon="trashOutline" class="text-[15px]" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- La búsqueda no encontró nada: es distinto de no tener sitios cargados. -->
        <div v-else-if="busqueda || hayFiltros" class="ds-card flex flex-col items-center py-14 text-center">
          <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
            <IonIcon :icon="searchOutline" class="text-[18px] text-ink-faint" />
          </div>
          <p class="text-sm font-medium text-ink">
            {{ busqueda ? `Ningún sitio coincide con «${busqueda}»` : 'Ningún sitio pasa los filtros' }}
          </p>
          <p class="text-xs text-ink-faint mt-1">
            {{ busqueda && hayFiltros ? 'Se busca por nombre y por URL, dentro de los filtros puestos.'
              : busqueda ? 'Se busca por nombre y por URL.' : 'Probá aflojar alguno.' }}
          </p>
          <button class="ds-btn-secondary mt-4" @click="busqueda = ''; limpiarFiltros()">
            Limpiar {{ busqueda && hayFiltros ? 'todo' : busqueda ? 'la búsqueda' : 'los filtros' }}
          </button>
        </div>

        <div v-else class="ds-card flex flex-col items-center py-14 text-center">
          <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
            <IonIcon :icon="globeOutline" class="text-[18px] text-ink-faint" />
          </div>
          <p class="text-sm font-medium text-ink">Todavía no hay sitios cargados</p>
          <p class="text-xs text-ink-faint mt-1">Cargá una URL y el sistema la chequea solo cada 5 minutos.</p>
          <button v-if="meStore.can('sitios:create')" class="ds-btn-primary mt-4" @click="abrirForm()">Agregar el primero</button>
        </div>

        <p v-if="(busqueda || hayFiltros) && sitiosFiltrados.length" class="text-2xs text-ink-faint mt-2">
          {{ sitiosFiltrados.length }} de {{ store.sitios.length }} sitios.
        </p>

        <p v-if="hayIncidentes" class="text-2xs text-ink-faint mt-2">
          Los sitios con alerta tienen un incidente abierto: se avisa una vez al detectarlo y otra al resolverse.
        </p>
      </div>

      <!-- Alta / edición -->
      <Teleport defer to="ion-app">
        <div v-if="modalForm" class="ds-modal-backdrop">
          <div class="ds-modal max-w-md" role="dialog" aria-modal="true" :aria-label="editando ? 'Editar sitio' : 'Nuevo sitio'">
            <h2 class="text-base font-semibold text-ink mb-3">{{ editando ? 'Editar sitio' : 'Nuevo sitio' }}</h2>
            <form class="space-y-3" @submit.prevent="guardar">
              <div>
                <label class="ds-label" for="st-nombre">Nombre</label>
                <input id="st-nombre" v-model="form.nombre" class="ds-input" required maxlength="150" />
              </div>
              <div>
                <label class="ds-label" for="st-url">URL</label>
                <input id="st-url" v-model="form.url" class="ds-input font-mono" required maxlength="255" placeholder="https://ejemplo.com.ar" />
                <p class="ds-hint">Tiene que incluir http:// o https://.</p>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="ds-label" for="st-servicio">Servicio</label>
                  <select id="st-servicio" v-model="form.servicioId" class="ds-input">
                    <option :value="null">—</option>
                    <option v-for="o in servicios" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </div>
                <div>
                  <label class="ds-label" for="st-servidor">Servidor</label>
                  <select id="st-servidor" v-model="form.servidorId" class="ds-input">
                    <option :value="null">—</option>
                    <option v-for="o in servidores" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </div>
              </div>

              <!-- FullGlass: hay sitios viejos que no lo usan, y la rama solo tiene sentido
                   para los que sí. La ruta es el puente con lo que el agente ve en el disco. -->
              <label class="flex items-start gap-2 text-sm text-ink cursor-pointer">
                <input v-model="form.usaFullglass" type="checkbox" class="accent-[#0F7660] mt-0.5" />
                <span>
                  Usa FullGlass
                  <span class="block text-2xs text-ink-faint">
                    Habilita ver en qué rama está y cambiarla desde acá.
                  </span>
                </span>
              </label>

              <div v-if="form.usaFullglass">
                <label class="ds-label" for="st-ruta">Carpeta del cliente en el servidor</label>
                <input
                  id="st-ruta" v-model="form.rutaFullglass" class="ds-input font-mono"
                  placeholder="/home/cliente" maxlength="255"
                />
                <p class="ds-hint">
                  La que contiene <span class="font-mono">configs/config_site.php</span>. Es lo que
                  permite cruzar este sitio con lo que reporta el agente del servidor.
                </p>
              </div>

              <label class="flex items-start gap-2 text-sm text-ink cursor-pointer">
                <input v-model="form.verificaMarcador" type="checkbox" class="accent-[#0F7660] mt-0.5" />
                <span>
                  Es un sitio nuestro
                  <span class="block text-2xs text-ink-faint">
                    Con esto marcado se verifica que la página traiga el marcador
                    <span class="font-mono">#app-conn-id</span> del footer, no solo que el servidor
                    responda. Destildalo para un sitio de un tercero.
                  </span>
                </span>
              </label>

              <div>
                <label class="ds-label" for="st-vence">Vencimiento del dominio</label>
                <input id="st-vence" v-model="form.dominioVenceAt" class="ds-input" type="date" />
                <p class="ds-hint">
                  Se completa solo con la consulta diaria. Cargala a mano si el registro del dominio
                  no publica la fecha (.io, .uy, .cl…): con una fecha manual el sistema deja de pisarla.
                </p>
              </div>

              <div>
                <label class="ds-label" for="st-obs">Observación</label>
                <input id="st-obs" v-model="form.observacion" class="ds-input" />
              </div>

              <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalForm = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!form.nombre.trim() || !form.url.trim()">
                  {{ editando ? 'Guardar' : 'Crear sitio' }}
                </button>
              </footer>
            </form>
          </div>
        </div>
      </Teleport>

      <!-- Detalle: historial de chequeos e incidentes -->
      <Teleport defer to="ion-app">
        <div v-if="modalDetalle && detalle" class="ds-modal-backdrop">
          <div class="ds-modal ds-modal-lg" role="dialog" aria-modal="true" aria-label="Detalle del sitio">
            <header class="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 class="text-base font-semibold text-ink">{{ detalle.nombre }}</h2>
                <p class="text-2xs text-ink-faint font-mono">{{ detalle.url }}</p>
              </div>
              <div class="text-right shrink-0">
                <p class="text-2xl font-semibold text-ink tnum">
                  {{ detalle.disponibilidad !== null ? `${detalle.disponibilidad}%` : '—' }}
                </p>
                <p class="text-2xs text-ink-faint">disponibilidad medida</p>
              </div>
            </header>

            <div class="grid grid-cols-3 gap-2 mb-4">
              <div class="border border-line rounded-lg p-2.5">
                <p class="text-2xs text-ink-faint">Estado</p>
                <p class="text-sm font-medium" :class="detalle.estado === 'online' ? 'text-ink' : 'text-danger'">
                  {{ ETIQUETA[detalle.estado] }}
                </p>
              </div>
              <div class="border border-line rounded-lg p-2.5">
                <p class="text-2xs text-ink-faint">Dominio {{ detalle.dominio ? `(${detalle.dominio})` : '' }}</p>
                <p class="text-sm tnum" :class="claseVence(detalle.dominioEstado)">
                  {{ textoVence(detalle.dominioVenceAt, detalle.dominioEstado) }}
                </p>
              </div>
              <div class="border border-line rounded-lg p-2.5">
                <p class="text-2xs text-ink-faint">Certificado</p>
                <p class="text-sm tnum" :class="claseVence(detalle.tlsEstado)">
                  {{ textoVence(detalle.tlsVenceAt, detalle.tlsEstado) }}
                </p>
              </div>
            </div>

            <div v-if="detalle.incidentes.length" class="mb-4">
              <h3 class="text-xs font-semibold text-ink mb-1.5">Incidentes</h3>
              <ul class="space-y-1">
                <li v-for="i in detalle.incidentes" :key="i.id" class="flex items-start gap-2 text-2xs">
                  <span class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" :class="i.resueltoAt ? 'bg-ok' : 'bg-danger'"></span>
                  <span class="text-ink-soft">
                    <span class="font-medium text-ink">{{ i.tipo }}</span> ·
                    {{ fechaHora(i.createdAt) }}{{ i.resueltoAt ? ` → resuelto ${fechaHora(i.resueltoAt)}` : ' · abierto' }}
                    <span v-if="i.detalle" class="block text-ink-faint">{{ i.detalle }}</span>
                  </span>
                </li>
              </ul>
            </div>

            <h3 class="text-xs font-semibold text-ink mb-1.5 flex items-center gap-1.5">
              <IonIcon :icon="timeOutline" class="text-[13px]" /> Últimos chequeos
            </h3>
            <div class="max-h-64 overflow-y-auto border border-line rounded-lg">
              <table class="ds-table">
                <tbody>
                  <tr v-for="c in detalle.chequeos" :key="c.id">
                    <td class="w-2">
                      <span class="w-1.5 h-1.5 rounded-full block" :class="colorEstado(c.estado)"></span>
                    </td>
                    <td class="text-2xs text-ink-faint tnum w-32">{{ fechaHora(c.createdAt) }}</td>
                    <td class="text-2xs tnum w-16">{{ c.httpStatus ?? '—' }}</td>
                    <td class="text-2xs tnum w-20">{{ c.tiempoMs ? `${c.tiempoMs} ms` : '—' }}</td>
                    <td class="text-2xs text-ink-soft">{{ c.motivo ?? 'OK' }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!detalle.chequeos.length" class="text-2xs text-ink-faint p-3 text-center">
                Todavía no hay chequeos: el primero sale en el próximo ciclo de 5 minutos.
              </p>
            </div>

            <footer class="flex justify-end pt-4">
              <button type="button" class="ds-btn-primary" @click="modalDetalle = false">Cerrar</button>
            </footer>
          </div>
        </div>
      </Teleport>
      <VistasSitioModal
        v-if="sitioVistas"
        :sitio="sitioVistas"
        @cerrar="sitioVistas = null"
        @cambio="vistasCambiaron"
      />

      <VelocidadSitioModal
        v-if="sitioVelocidad"
        :sitio="sitioVelocidad"
        @cerrar="sitioVelocidad = null"
      />
      <Teleport defer to="ion-app">
        <div v-if="sitioRama" class="ds-modal-backdrop">
          <div class="ds-modal max-w-md" role="dialog" aria-modal="true" aria-label="Cambiar de rama">
            <h2 class="text-base font-semibold text-ink mb-1">Cambiar de rama</h2>
            <p class="text-xs text-ink-soft mb-4">
              <strong class="text-ink">{{ sitioRama.nombre }}</strong> está en
              <strong class="text-ink">{{ sitioRama.rama }}</strong>.
              El cambio corre el script del servidor sobre
              <code class="break-all">{{ sitioRama.rutaFullglass }}</code>.
            </p>

            <div class="mb-3">
              <span class="ds-label">Pasar a</span>
              <div class="flex gap-1.5">
                <button
                  v-for="r in [RAMA_ESTABLE, RAMA_PRUEBAS]" :key="r" type="button"
                  class="ds-pill" :class="{ 'ds-pill-activa': ramaDestino === r }"
                  :style="{ '--c': r === RAMA_ESTABLE ? '#0F7660' : '#b45309' }"
                  @click="ramaDestino = r"
                >{{ r }}</button>
              </div>
              <p v-if="ramaDestino === RAMA_PRUEBAS" class="ds-hint text-warn">
                En «{{ RAMA_PRUEBAS }}» el cliente ve la versión de pruebas.
                Acordate de volverlo a «{{ RAMA_ESTABLE }}».
              </p>
            </div>

            <p v-if="errorRama" class="ds-error" role="alert">{{ errorRama }}</p>

            <footer class="flex justify-end gap-2 pt-1">
              <button type="button" class="ds-btn-secondary" @click="sitioRama = null">Cancelar</button>
              <button
                type="button" class="ds-btn-primary"
                :disabled="cambiandoRama || ramaDestino === sitioRama.rama"
                @click="confirmarRama"
              >{{ cambiandoRama ? 'Lanzando…' : `Pasar a ${ramaDestino}` }}</button>
            </footer>
          </div>
        </div>
      </Teleport>

      <!-- Detectar la rama de un cliente que no la declara. El fondo NO cierra (regla de la
           casa): se sale por Cancelar o con Escape. -->
      <Teleport to="body">
        <div v-if="sitioDetectar" class="ds-modal-backdrop" @keydown.esc="sitioDetectar = null">
          <div class="ds-modal max-w-md" role="dialog" aria-modal="true" aria-label="Detectar la rama">
            <h2 class="text-base font-semibold text-ink mb-1">Detectar la rama</h2>
            <p class="ds-hint mb-3">
              <strong class="text-ink">{{ sitioDetectar.nombre }}</strong> no declara su rama en
              <code>config_site.php</code>, por eso no se puede mostrar.
            </p>
            <p class="ds-hint mb-3">
              Esto <strong class="text-ink">no lo cambia de rama</strong>: mira a qué carpeta de
              FullGlass apuntan sus archivos, deduce en cuál está y deja la clave
              <code>branch</code> declarada. Si los archivos no coinciden entre sí, no escribe
              nada y lo dice en Ejecuciones.
            </p>
            <p class="ds-hint mb-3">
              Carpeta: <code class="break-all">{{ sitioDetectar.rutaFullglass }}</code>
            </p>

            <p v-if="errorDetectar" class="ds-error" role="alert">{{ errorDetectar }}</p>

            <footer class="flex justify-end gap-2 pt-1">
              <button type="button" class="ds-btn-secondary" @click="sitioDetectar = null">Cancelar</button>
              <button type="button" class="ds-btn-primary" :disabled="detectando" @click="confirmarDetectar">
                {{ detectando ? 'Lanzando…' : 'Detectar y declarar' }}
              </button>
            </footer>
          </div>
        </div>
      </Teleport>

    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
.row-action {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
.row-action:disabled { opacity: 0.5; cursor: default; }
</style>
