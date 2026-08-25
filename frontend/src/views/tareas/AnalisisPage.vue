<script setup lang="ts">
/**
 * Análisis de tareas — la pantalla de estadísticas del módulo (GET /tareas/analisis).
 *
 * Reúne siete bloques que responden preguntas distintas:
 *  1. Equipo — las tarjetas y la tabla por persona que ANTES vivían en el Panel.
 *  2. Realizadas en un rango — qué se cerró entre dos fechas (default: el mes actual).
 *  3. Creadas vs. completadas por mes — si el equipo gana o pierde terreno en el año.
 *  4. Por lista — cuántas tareas de cada estado tiene cada lista, completadas incluidas.
 *  5. Por espacio — lo mismo un escalón más arriba.
 *  6. Antigüedad y estancadas — hace cuánto están abiertas y cuáles nadie toca.
 *  7. Prioridad — cuántas urgentes hay y cuántas de esas no tienen responsable.
 *
 * Todo el estado (rango, año, espacios, días de estancada) vive en el QUERY STRING: así una
 * vista concreta —«las vencidas de Desarrollo del mes pasado»— se comparte con un link.
 * Es SOLO LECTURA: cada número lleva al listado que lo produce, no se edita nada desde acá.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  chevronBackOutline, funnelOutline, downloadOutline, peopleOutline, calendarOutline,
  trendingUpOutline, listOutline, albumsOutline, hourglassOutline, flagOutline,
} from 'ionicons/icons'
import { useTareasStore, ESTADOS_TAREA, PRIORIDADES } from '@/stores/tareas'
import ThOrdenable from '@/components/shared/ThOrdenable.vue'
import BanderaPrioridad from '@/components/tareas/BanderaPrioridad.vue'
import GraficoLinea from '@/components/dashboard/GraficoLinea.vue'
import { useOrdenTabla } from '@/composables/useOrdenTabla'
import { useToast } from '@/composables/useToast'
import { descargarCsv } from '@/composables/useCsv'
import { fecha as fmtFecha, fechaHora, duracion, MESES } from '@/composables/useFormato'

interface Conteos { abierta: number; en_progreso: number; pausada: number; en_revision: number; completada: number }
interface FilaLista {
  listaId: number; lista: string; activa: boolean
  espacioId: number; espacio: string
  estados: Conteos; total: number; vencidas: number
}
interface FilaEspacio { espacioId: number; espacio: string; estados: Conteos; total: number; vencidas: number }
interface EnProgresoItem {
  id: number; nombre: string; prioridad: string; usuario: string
  espacioId: number; listaId: number; espacio: string; lista: string; vencida: boolean; desde: string
}
interface FilaUsuario {
  userId: number; nombre: string; activo: boolean
  pendientes: number; hoy: number; porVencer: number; vencidas: number
  enProgreso: number; pausadas: number
  promedio: { segundos: number; sobre: number } | null
}
/**
 * Carga de una lista: lo que sigue pendiente HOY + lo que se cerró EN EL PERÍODO.
 * `total` es la suma de las dos, y es por donde ordena la tabla por defecto.
 */
interface ListaDelPeriodo {
  listaId: number; lista: string; espacioId: number; espacio: string
  pendientes: number; realizadas: number; total: number
}
interface Estancada {
  id: number; nombre: string; prioridad: string; estado: string
  espacioId: number; espacio: string; listaId: number; lista: string
  asignado: string | null; dias: number
}
interface Analisis {
  dias: number
  anio: number
  espacios: Array<{ id: number; nombre: string; activo: boolean }>
  espaciosFiltro: number[]
  equipo: {
    tarjetas: (Record<string, number> & { personasConVencidas: number }) | null
    enProgreso: EnProgresoItem[]
    porUsuario: FilaUsuario[]
    dias: number
  }
  porLista: FilaLista[]
  porEspacio: FilaEspacio[]
  rango: {
    desde: string; hasta: string
    creadas: number; completadas: number
    aTiempo: number; tarde: number; sinFecha: number
    porUsuario: Array<{ userId: number; nombre: string; n: number; aTiempo: number }>
    porLista: ListaDelPeriodo[]
  }
  serie: { anio: number; creadas: number[]; completadas: number[] }
  antiguedad: {
    diasEstancada: number
    cubetas: Array<{ clave: string; label: string; n: number }>
    totalEstancadas: number
    estancadas: Estancada[]
  }
  prioridad: Array<{ prioridad: string; n: number; sinAsignar: number }>
}

const route = useRoute()
const router = useRouter()
const tareasStore = useTareasStore()
const toast = useToast()

const data = ref<Analisis | null>(null)
const loading = ref(false)
/**
 * La pantalla pide `tareas:analisis`, que NO viene con `tareas:read`: alguien con acceso al
 * tablero puede llegar acá por un link viejo o un favorito. Sin este estado vería una página
 * en blanco con un toast; así lee qué le falta.
 */
const sinPermiso = ref(false)

/** ISO local (no `toISOString()`, que corre al UTC y en la madrugada devuelve el día anterior). */
const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Mes actual completo: el rango que la pantalla trae puesto al abrirse. */
function mesActual(): { desde: string; hasta: string } {
  const h = new Date()
  return { desde: iso(new Date(h.getFullYear(), h.getMonth(), 1)), hasta: iso(new Date(h.getFullYear(), h.getMonth() + 1, 0)) }
}

const q = (k: string): string => String(route.query[k] ?? '')
const desde = computed(() => q('desde') || mesActual().desde)
const hasta = computed(() => q('hasta') || mesActual().hasta)
const anio = computed(() => Number(q('anio')) || new Date().getFullYear())
const estancadas = computed(() => Number(q('estancadas')) || 14)
const filtroEspacios = computed<number[]>(() =>
  q('e').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0),
)

const panelEspacios = ref(false)
/** Una lista sin ninguna tarea no dice nada del trabajo: se puede esconder. */
const ocultarVacias = ref(true)
const buscarLista = ref('')

/** Cambia claves del query conservando el resto (los filtros no se pisan entre sí). */
function setQuery(cambios: Record<string, string | number | undefined>): void {
  const merged: Record<string, unknown> = { ...route.query, ...cambios }
  const limpio: Record<string, string> = {}
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null && v !== '') limpio[k] = String(v)
  }
  void router.replace({ query: limpio })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    data.value = await tareasStore.fetchAnalisis({
      desde: desde.value,
      hasta: hasta.value,
      anio: anio.value,
      estancadas: estancadas.value,
      e: filtroEspacios.value.join(','),
    })
    sinPermiso.value = false
  } catch (e) {
    if ((e as { response?: { status?: number } }).response?.status === 403) sinPermiso.value = true
    else toast.error('No se pudo cargar el análisis')
  } finally {
    loading.value = false
  }
}

// ── Filtro de espacios ────────────────────────────────────────────────────────
function toggleEspacio(id: number): void {
  const act = filtroEspacios.value.includes(id)
    ? filtroEspacios.value.filter(x => x !== id)
    : [...filtroEspacios.value, id]
  setQuery({ e: act.join(',') || undefined })
}
function limpiarEspacios(): void { setQuery({ e: undefined }) }
const etiquetaEspacios = computed(() => {
  const n = filtroEspacios.value.length
  if (!n) return 'Todos los espacios'
  if (n === 1) return data.value?.espacios.find(x => x.id === filtroEspacios.value[0])?.nombre ?? '1 espacio'
  return `${n} espacios`
})

// ── Rango de fechas ───────────────────────────────────────────────────────────
/** Atajos de rango: son los cortes que se piden de verdad (mes, mes pasado, año). */
const ATAJOS: Array<{ label: string; calc: () => { desde: string; hasta: string } }> = [
  { label: 'Este mes', calc: mesActual },
  {
    label: 'Mes pasado',
    calc: () => {
      const h = new Date()
      return { desde: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), hasta: iso(new Date(h.getFullYear(), h.getMonth(), 0)) }
    },
  },
  {
    label: 'Últimos 30 días',
    calc: () => {
      const h = new Date()
      const d = new Date(h); d.setDate(d.getDate() - 29)
      return { desde: iso(d), hasta: iso(h) }
    },
  },
  {
    label: 'Este año',
    calc: () => {
      const h = new Date()
      return { desde: iso(new Date(h.getFullYear(), 0, 1)), hasta: iso(new Date(h.getFullYear(), 11, 31)) }
    },
  },
]
function aplicarAtajo(a: (typeof ATAJOS)[number]): void {
  setQuery(a.calc())
}
const atajoActivo = computed(() =>
  ATAJOS.find(a => { const r = a.calc(); return r.desde === desde.value && r.hasta === hasta.value })?.label ?? null,
)

const cumplimientoPct = computed(() => {
  const r = data.value?.rango
  if (!r) return null
  const conFecha = r.aTiempo + r.tarde
  return conFecha ? Math.round((r.aTiempo / conFecha) * 100) : null
})

// ── Tabla por lista ───────────────────────────────────────────────────────────
/** Aplanada: `useOrdenTabla` ordena por clave de primer nivel, y los estados están anidados. */
const filasLista = computed(() =>
  (data.value?.porLista ?? [])
    .filter(f => !ocultarVacias.value || f.total > 0)
    .filter(f => {
      const t = buscarLista.value.trim().toLowerCase()
      return !t || f.lista.toLowerCase().includes(t) || f.espacio.toLowerCase().includes(t)
    })
    .map(f => ({ ...f, ...f.estados, pendientes: f.total - f.estados.completada })),
)
const ordenListas = useOrdenTabla(
  filasLista,
  (f, col) => (f as unknown as Record<string, string | number | boolean | null>)[col],
)

const totalesListas = computed(() => {
  const base = { total: 0, completada: 0, pendientes: 0, vencidas: 0 }
  for (const f of filasLista.value) {
    base.total += f.total; base.completada += f.estados.completada
    base.pendientes += f.pendientes; base.vencidas += f.vencidas
  }
  return base
})

function exportarListas(): void {
  descargarCsv(
    'tareas-por-lista',
    ['Espacio', 'Lista', 'Activa', ...Object.values(ESTADOS_TAREA).map(e => e.label), 'Total', 'Vencidas'],
    filasLista.value.map(f => [
      f.espacio, f.lista, f.activa ? 'Sí' : 'No',
      ...Object.keys(ESTADOS_TAREA).map(k => f.estados[k as keyof Conteos]),
      f.total, f.vencidas,
    ]),
  )
}
function exportarRealizadas(): void {
  const r = data.value?.rango
  if (!r) return
  descargarCsv(
    `tareas-por-lista-${r.desde}_${r.hasta}`,
    ['Espacio', 'Lista', 'Pendientes', 'Realizadas', 'Total'],
    ordenPeriodo.ordenadas.value.map(f => [f.espacio, f.lista, f.pendientes, f.realizadas, f.total]),
  )
}

// ── Tabla «por lista» del período ─────────────────────────────────────────────
/** Arranca por total, de mayor a menor; los encabezados cambian el orden. */
const filasPeriodo = computed<ListaDelPeriodo[]>(() => data.value?.rango.porLista ?? [])
const ordenPeriodo = useOrdenTabla(
  filasPeriodo,
  (f, col) => (f as unknown as Record<string, string | number | boolean | null>)[col],
  { columna: 'total', dir: 'desc' },
)

// ── Bloques visuales ──────────────────────────────────────────────────────────
const maxCubeta = computed(() => Math.max(1, ...(data.value?.antiguedad.cubetas ?? []).map(c => c.n)))
const maxPrioridad = computed(() => Math.max(1, ...(data.value?.prioridad ?? []).map(p => p.n)))
const totalPendientesPrioridad = computed(() => (data.value?.prioridad ?? []).reduce((a, p) => a + p.n, 0))

const series = computed(() => {
  const s = data.value?.serie
  return s ? [{ label: 'Creadas', data: s.creadas }, { label: 'Completadas', data: s.completadas }] : []
})
const anios = computed(() => {
  const hoy = new Date().getFullYear()
  return Array.from({ length: 6 }, (_, i) => hoy - i)
})

const irALista = (espacioId: number, listaId: number): void => {
  void router.push(`/tareas/espacios/${espacioId}/listas/${listaId}`)
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void load() })
onIonViewWillEnter(() => { if (loadedOnce) void load() })
watch(() => route.query, () => { if (loadedOnce && route.path.includes('/tareas/analisis')) void load() })
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

        <button class="ds-btn-ghost h-8 -ml-2 mb-3" @click="router.push('/tareas')">
          <IonIcon :icon="chevronBackOutline" class="text-[14px]" />
          Tareas
        </button>

        <header class="flex flex-wrap items-start justify-between gap-3 pb-4">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Análisis de tareas</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              Estadísticas de los espacios que podés ver — solo lectura.
            </p>
          </div>
          <button
            v-if="!sinPermiso && (data?.espacios.length ?? 0) > 1"
            class="ds-btn-secondary h-8"
            :class="{ 'border-accent/40 text-accent-ink bg-accent-soft': filtroEspacios.length }"
            :aria-expanded="panelEspacios" aria-controls="panel-espacios-analisis"
            @click="panelEspacios = !panelEspacios"
          >
            <IonIcon :icon="funnelOutline" class="text-[14px]" />
            {{ etiquetaEspacios }}
          </button>
        </header>

        <!-- Filtro por espacio: recorta TODOS los bloques de la pantalla a la vez. -->
        <div v-if="panelEspacios && data" id="panel-espacios-analisis" class="ds-card p-4 mb-4 ds-enter">
          <div class="flex items-center justify-between mb-2">
            <span class="ds-label mb-0">Espacios de trabajo</span>
            <button class="ds-btn-ghost h-7 px-2 text-xs" :disabled="!filtroEspacios.length" @click="limpiarEspacios">
              Todos
            </button>
          </div>
          <div class="divide-y divide-line-soft max-h-56 overflow-y-auto -mx-1 px-1">
            <label
              v-for="e in data.espacios" :key="e.id"
              class="flex items-center gap-2.5 min-h-[36px] py-1.5 cursor-pointer"
            >
              <input
                type="checkbox" class="accent-[#0F7660] shrink-0"
                :checked="filtroEspacios.includes(e.id)" @change="toggleEspacio(e.id)"
              />
              <span class="min-w-0 flex-1 text-sm text-ink break-words">{{ e.nombre }}</span>
              <span v-if="!e.activo" class="ds-badge-neutral shrink-0">inactivo</span>
            </label>
          </div>
        </div>

        <div v-if="sinPermiso" class="ds-card px-6 py-12 text-center">
          <p class="text-sm font-medium text-ink">No tenés permiso para ver el análisis de tareas.</p>
          <p class="text-xs text-ink-faint mt-1">
            Esta pantalla se otorga con la capability <code class="tnum">tareas:analisis</code>,
            aparte del acceso al tablero. Pedísela a un administrador.
          </p>
        </div>

        <div v-else-if="loading && !data" class="space-y-3">
          <div v-for="i in 4" :key="i" class="ds-skeleton h-28"></div>
        </div>

        <template v-if="data && !sinPermiso">
          <!-- ═══ 1. Equipo ═══ -->
          <section class="mb-7">
            <h2 class="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
              <IonIcon :icon="peopleOutline" class="text-[15px] text-ink-faint" />
              Tareas del equipo
            </h2>
            <template v-if="data.equipo.tarjetas">
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=pendientes&u=todos')">
                  <p class="text-2xs uppercase tracking-wide text-ink-faint">Pendientes</p>
                  <p class="mt-1 text-lg font-semibold tnum text-ink">{{ data.equipo.tarjetas.pendientes }}</p>
                  <p class="text-2xs text-ink-faint tnum">{{ data.equipo.tarjetas.enProgreso }} en progreso · {{ data.equipo.tarjetas.pausadas }} pausada(s)</p>
                </button>
                <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=hoy&u=todos')">
                  <p class="text-2xs uppercase tracking-wide text-ink-faint">Para hoy</p>
                  <p class="mt-1 text-lg font-semibold tnum" :class="data.equipo.tarjetas.hoy ? 'text-warn' : 'text-ink'">{{ data.equipo.tarjetas.hoy }}</p>
                </button>
                <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=por_vencer&u=todos')">
                  <p class="text-2xs uppercase tracking-wide text-ink-faint">Por vencer</p>
                  <p class="mt-1 text-lg font-semibold tnum" :class="data.equipo.tarjetas.porVencer ? 'text-warn' : 'text-ink'">{{ data.equipo.tarjetas.porVencer }}</p>
                  <p class="text-2xs text-ink-faint">próximos {{ data.equipo.dias }} días</p>
                </button>
                <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=vencidas&u=todos')">
                  <p class="text-2xs uppercase tracking-wide text-ink-faint">Vencidas</p>
                  <p class="mt-1 text-lg font-semibold tnum" :class="data.equipo.tarjetas.vencidas ? 'text-danger' : 'text-ink'">{{ data.equipo.tarjetas.vencidas }}</p>
                  <p v-if="data.equipo.tarjetas.vencidas" class="text-2xs text-ink-faint tnum">en {{ data.equipo.tarjetas.personasConVencidas }} persona(s)</p>
                </button>
              </div>

              <div class="grid lg:grid-cols-2 gap-3">
                <div class="ds-card p-4">
                  <h3 class="text-xs font-semibold text-ink mb-2">Qué está haciendo cada uno</h3>
                  <div v-if="data.equipo.enProgreso.length" class="space-y-2">
                    <div v-for="t in data.equipo.enProgreso" :key="t.id" class="flex items-start gap-2">
                      <BanderaPrioridad :prioridad="t.prioridad" :size="13" />
                      <div class="min-w-0 flex-1">
                        <p class="text-xs text-ink">
                          <span class="font-medium">{{ t.usuario }}</span> ·
                          <button class="hover:text-accent underline-offset-2 hover:underline" @click="irALista(t.espacioId, t.listaId)">{{ t.nombre }}</button>
                          <span v-if="t.vencida" class="ds-badge-danger ml-1">vencida</span>
                        </p>
                        <p class="text-2xs text-ink-faint">{{ t.espacio }} · {{ t.lista }} · desde {{ fechaHora(t.desde) }}</p>
                      </div>
                    </div>
                  </div>
                  <p v-else class="text-xs text-ink-faint py-3">Nadie tiene tareas en progreso ahora mismo.</p>
                </div>

                <div class="ds-card overflow-x-auto">
                  <table class="ds-table">
                    <thead>
                      <tr><th>Persona</th><th>Pend.</th><th>Hoy</th><th>Venc.</th><th>Prom. trabajo</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="u in data.equipo.porUsuario" :key="u.userId" :class="{ 'opacity-50': !u.activo }">
                        <td class="text-sm" :class="u.userId ? 'text-ink' : 'text-ink-faint italic'">
                          {{ u.userId ? u.nombre : 'Sin responsable' }}{{ u.activo ? '' : ' (inactivo)' }}
                        </td>
                        <td class="tnum text-ink-soft">{{ u.pendientes || '—' }}</td>
                        <td class="tnum" :class="u.hoy ? 'text-warn' : 'text-ink-faint'">{{ u.hoy || '—' }}</td>
                        <td class="tnum" :class="u.vencidas ? 'text-danger font-medium' : 'text-ink-faint'">{{ u.vencidas || '—' }}</td>
                        <td class="text-2xs text-ink-soft tnum">
                          {{ u.promedio ? `${duracion(u.promedio.segundos)} · ${u.promedio.sobre} tarea(s)` : 'sin datos' }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p class="px-3 py-2 text-2xs text-ink-faint border-t border-line-soft">
                    Promedio: desde «en progreso» hasta revisión/completada, descontando pausas.
                  </p>
                </div>
              </div>
            </template>
            <div v-else class="ds-card px-6 py-8 text-center">
              <p class="text-sm text-ink-soft">No tenés acceso a ningún espacio de trabajo.</p>
            </div>
          </section>

          <!-- ═══ 2. Realizadas en un rango ═══ -->
          <section class="mb-7">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 class="text-sm font-semibold text-ink flex items-center gap-1.5">
                <IonIcon :icon="calendarOutline" class="text-[15px] text-ink-faint" />
                Realizadas en un período
              </h2>
              <button
                v-if="data.rango.porLista.length" class="ds-btn-ghost h-7 px-2 text-xs"
                @click="exportarRealizadas"
              >
                <IonIcon :icon="downloadOutline" class="text-[13px]" /> CSV
              </button>
            </div>

            <div class="ds-card p-4 mb-3">
              <div class="flex flex-wrap items-end gap-3">
                <div>
                  <label class="ds-label" for="an-desde">Desde</label>
                  <input
                    id="an-desde" class="ds-input h-8 w-[150px]" type="date" :value="desde"
                    @change="setQuery({ desde: ($event.target as HTMLInputElement).value })"
                  />
                </div>
                <div>
                  <label class="ds-label" for="an-hasta">Hasta</label>
                  <input
                    id="an-hasta" class="ds-input h-8 w-[150px]" type="date" :value="hasta"
                    @change="setQuery({ hasta: ($event.target as HTMLInputElement).value })"
                  />
                </div>
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="a in ATAJOS" :key="a.label" type="button"
                    class="cat-tab" :class="{ 'cat-activa': atajoActivo === a.label }"
                    @click="aplicarAtajo(a)"
                  >{{ a.label }}</button>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <div class="ds-card px-4 py-3">
                <p class="text-2xs uppercase tracking-wide text-ink-faint">Completadas</p>
                <p class="mt-1 text-lg font-semibold tnum text-accent-ink">{{ data.rango.completadas }}</p>
                <p class="text-2xs text-ink-faint">{{ fmtFecha(data.rango.desde) }} a {{ fmtFecha(data.rango.hasta) }}</p>
              </div>
              <div class="ds-card px-4 py-3">
                <p class="text-2xs uppercase tracking-wide text-ink-faint">Creadas en el período</p>
                <p class="mt-1 text-lg font-semibold tnum text-ink">{{ data.rango.creadas }}</p>
                <p class="text-2xs text-ink-faint">
                  {{ data.rango.completadas >= data.rango.creadas ? 'se cerró más de lo que entró' : 'entró más de lo que se cerró' }}
                </p>
              </div>
              <div class="ds-card px-4 py-3">
                <p class="text-2xs uppercase tracking-wide text-ink-faint">A tiempo</p>
                <p class="mt-1 text-lg font-semibold tnum text-ink">
                  {{ cumplimientoPct === null ? '—' : `${cumplimientoPct}%` }}
                </p>
                <p class="text-2xs text-ink-faint tnum">{{ data.rango.aTiempo }} a tiempo · {{ data.rango.tarde }} tarde</p>
              </div>
              <div class="ds-card px-4 py-3">
                <p class="text-2xs uppercase tracking-wide text-ink-faint">Sin vencimiento</p>
                <p class="mt-1 text-lg font-semibold tnum text-ink">{{ data.rango.sinFecha }}</p>
                <p class="text-2xs text-ink-faint">no hay contra qué medirlas</p>
              </div>
            </div>

            <div class="grid lg:grid-cols-5 gap-3">
              <div class="ds-card overflow-x-auto lg:col-span-2">
                <table class="ds-table">
                  <thead><tr><th>Cerró</th><th>Tareas</th><th>A tiempo</th></tr></thead>
                  <tbody>
                    <tr v-for="u in data.rango.porUsuario" :key="u.userId">
                      <td class="text-sm text-ink">{{ u.nombre }}</td>
                      <td class="tnum text-ink-soft">{{ u.n }}</td>
                      <td class="tnum text-ink-faint">{{ u.aTiempo }}</td>
                    </tr>
                    <tr v-if="!data.rango.porUsuario.length">
                      <td colspan="3" class="text-xs text-ink-faint py-4 text-center">Nadie cerró tareas en este período.</td>
                    </tr>
                  </tbody>
                </table>
                <p class="px-3 py-2 text-2xs text-ink-faint border-t border-line-soft">
                  Cuenta quién marcó la tarea como completada (dato de la bitácora), no a quién estaba asignada.
                </p>
              </div>

              <!--
                Carga por lista: lo que sigue PENDIENTE hoy contra lo que se CERRÓ en el
                período. Es otra pregunta que la del bloque «Tareas por lista» de más abajo,
                que abre por estado y no mira fechas. Quedan afuera las listas sin nada en
                ninguna de las dos columnas. Los encabezados reordenan como en toda tabla.
              -->
              <div class="ds-card overflow-auto max-h-[360px] lg:col-span-3">
                <table class="ds-table tabla-pegada" style="min-width: 460px">
                  <thead>
                    <tr>
                      <ThOrdenable columna="espacio" :activa="ordenPeriodo.columna.value" :dir="ordenPeriodo.dir.value" @ordenar="ordenPeriodo.ordenarPor">Espacio</ThOrdenable>
                      <ThOrdenable columna="lista" :activa="ordenPeriodo.columna.value" :dir="ordenPeriodo.dir.value" @ordenar="ordenPeriodo.ordenarPor">Lista</ThOrdenable>
                      <ThOrdenable columna="pendientes" :activa="ordenPeriodo.columna.value" :dir="ordenPeriodo.dir.value" @ordenar="ordenPeriodo.ordenarPor">Pendientes</ThOrdenable>
                      <ThOrdenable columna="realizadas" :activa="ordenPeriodo.columna.value" :dir="ordenPeriodo.dir.value" @ordenar="ordenPeriodo.ordenarPor">Realizadas</ThOrdenable>
                      <ThOrdenable columna="total" :activa="ordenPeriodo.columna.value" :dir="ordenPeriodo.dir.value" @ordenar="ordenPeriodo.ordenarPor">Total</ThOrdenable>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="f in ordenPeriodo.ordenadas.value" :key="f.listaId">
                      <td class="text-ink-soft text-sm">{{ f.espacio }}</td>
                      <td>
                        <button class="font-medium text-ink hover:text-accent transition-colors text-left" @click="irALista(f.espacioId, f.listaId)">
                          {{ f.lista }}
                        </button>
                      </td>
                      <td class="tnum" :class="f.pendientes ? 'text-ink-soft' : 'text-ink-faint'">{{ f.pendientes || '—' }}</td>
                      <td class="tnum" :class="f.realizadas ? 'text-accent-ink font-medium' : 'text-ink-faint'">{{ f.realizadas || '—' }}</td>
                      <td class="tnum font-medium text-ink">{{ f.total }}</td>
                    </tr>
                    <tr v-if="!filasPeriodo.length">
                      <td colspan="5" class="text-xs text-ink-faint py-6 text-center">
                        Ninguna lista tiene tareas pendientes ni cerradas en este período.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <!-- ═══ 3. Creadas vs. completadas por mes ═══ -->
          <section class="mb-7">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 class="text-sm font-semibold text-ink flex items-center gap-1.5">
                <IonIcon :icon="trendingUpOutline" class="text-[15px] text-ink-faint" />
                Creadas vs. completadas por mes
              </h2>
              <select
                class="ds-input h-8 w-[110px]" aria-label="Año"
                :value="anio" @change="setQuery({ anio: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="a in anios" :key="a" :value="a">{{ a }}</option>
              </select>
            </div>
            <div class="ds-card p-4">
              <GraficoLinea :series="series" :alto="240" formato="numero" />
              <p class="mt-2 text-2xs text-ink-faint">
                Cerradas: cada paso a «completada» de la bitácora ({{ MESES[0] }} a {{ MESES[11] }} de {{ data.serie.anio }}).
                Una tarea reabierta y vuelta a cerrar cuenta una vez por mes.
              </p>
            </div>
          </section>

          <!-- ═══ 4. Por lista ═══ -->
          <section class="mb-7">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 class="text-sm font-semibold text-ink flex items-center gap-1.5">
                <IonIcon :icon="listOutline" class="text-[15px] text-ink-faint" />
                Tareas por lista
                <span class="text-ink-faint font-normal tnum">· {{ filasLista.length }}</span>
              </h2>
              <div class="flex flex-wrap items-center gap-2">
                <input
                  v-model="buscarLista" class="ds-input h-8 w-[180px]" type="search"
                  placeholder="Buscar lista o espacio…" aria-label="Buscar lista"
                />
                <label class="flex items-center gap-1.5 text-xs text-ink cursor-pointer">
                  <input v-model="ocultarVacias" type="checkbox" class="accent-[#0F7660]" /> Ocultar vacías
                </label>
                <button v-if="filasLista.length" class="ds-btn-ghost h-7 px-2 text-xs" @click="exportarListas">
                  <IonIcon :icon="downloadOutline" class="text-[13px]" /> CSV
                </button>
              </div>
            </div>
            <!--
              Alto acotado: un espacio con 60 listas empujaba el resto de la pantalla fuera de
              la vista. Se recorre con scroll propio y el encabezado queda pegado para no
              perder de qué columna es cada número.
            -->
            <div class="ds-card overflow-auto max-h-[540px]">
              <table class="ds-table tabla-pegada" style="min-width: 760px">
                <thead>
                  <tr>
                    <ThOrdenable columna="espacio" :activa="ordenListas.columna.value" :dir="ordenListas.dir.value" @ordenar="ordenListas.ordenarPor">Espacio</ThOrdenable>
                    <ThOrdenable columna="lista" :activa="ordenListas.columna.value" :dir="ordenListas.dir.value" @ordenar="ordenListas.ordenarPor">Lista</ThOrdenable>
                    <ThOrdenable
                      v-for="(meta, key) in ESTADOS_TAREA" :key="key" :columna="key"
                      :activa="ordenListas.columna.value" :dir="ordenListas.dir.value" @ordenar="ordenListas.ordenarPor"
                    >{{ meta.label }}</ThOrdenable>
                    <ThOrdenable columna="total" :activa="ordenListas.columna.value" :dir="ordenListas.dir.value" @ordenar="ordenListas.ordenarPor">Total</ThOrdenable>
                    <ThOrdenable columna="vencidas" :activa="ordenListas.columna.value" :dir="ordenListas.dir.value" @ordenar="ordenListas.ordenarPor">Vencidas</ThOrdenable>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in ordenListas.ordenadas.value" :key="f.listaId" :class="{ 'opacity-60': !f.activa }">
                    <td class="text-ink-soft text-sm">{{ f.espacio }}</td>
                    <td>
                      <button class="font-medium text-ink hover:text-accent transition-colors text-left" @click="irALista(f.espacioId, f.listaId)">
                        {{ f.lista }}
                      </button>
                      <span v-if="!f.activa" class="ds-badge-neutral ml-1.5">inactiva</span>
                    </td>
                    <td
                      v-for="(meta, key) in ESTADOS_TAREA" :key="key"
                      class="tnum" :style="f.estados[key as keyof Conteos] ? { color: meta.color } : {}"
                      :class="{ 'text-ink-faint': !f.estados[key as keyof Conteos] }"
                    >{{ f.estados[key as keyof Conteos] || '—' }}</td>
                    <td class="tnum font-medium text-ink">{{ f.total || '—' }}</td>
                    <td class="tnum" :class="f.vencidas ? 'text-danger font-medium' : 'text-ink-faint'">{{ f.vencidas || '—' }}</td>
                  </tr>
                  <tr v-if="!filasLista.length">
                    <td :colspan="5 + Object.keys(ESTADOS_TAREA).length" class="text-xs text-ink-faint py-6 text-center">
                      No hay listas que mostrar con estos filtros.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="filasLista.length" class="mt-1.5 text-2xs text-ink-faint tnum">
              {{ totalesListas.total }} tareas · {{ totalesListas.pendientes }} pendientes ·
              {{ totalesListas.completada }} completadas · {{ totalesListas.vencidas }} vencidas.
            </p>
          </section>

          <!-- ═══ 5. Por espacio ═══ -->
          <section v-if="data.porEspacio.length > 1" class="mb-7">
            <h2 class="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
              <IonIcon :icon="albumsOutline" class="text-[15px] text-ink-faint" />
              Por espacio de trabajo
            </h2>
            <div class="ds-card overflow-x-auto">
              <table class="ds-table" style="min-width: 660px">
                <thead>
                  <tr>
                    <th>Espacio</th>
                    <th v-for="(meta, key) in ESTADOS_TAREA" :key="key">{{ meta.label }}</th>
                    <th>Total</th><th>Vencidas</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in data.porEspacio" :key="f.espacioId">
                    <td class="font-medium text-ink text-sm">{{ f.espacio }}</td>
                    <td
                      v-for="(meta, key) in ESTADOS_TAREA" :key="key"
                      class="tnum" :style="f.estados[key as keyof Conteos] ? { color: meta.color } : {}"
                      :class="{ 'text-ink-faint': !f.estados[key as keyof Conteos] }"
                    >{{ f.estados[key as keyof Conteos] || '—' }}</td>
                    <td class="tnum font-medium text-ink">{{ f.total || '—' }}</td>
                    <td class="tnum" :class="f.vencidas ? 'text-danger font-medium' : 'text-ink-faint'">{{ f.vencidas || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- ═══ 6. Antigüedad y estancadas ═══ -->
          <section class="mb-7 grid lg:grid-cols-2 gap-3">
            <div>
              <h2 class="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
                <IonIcon :icon="hourglassOutline" class="text-[15px] text-ink-faint" />
                Antigüedad de las pendientes
              </h2>
              <div class="ds-card p-4 space-y-2.5">
                <div v-for="c in data.antiguedad.cubetas" :key="c.clave">
                  <div class="flex items-center justify-between text-xs mb-1">
                    <span class="text-ink-soft">{{ c.label }}</span>
                    <span class="tnum font-medium text-ink">{{ c.n }}</span>
                  </div>
                  <div class="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div class="h-full rounded-full bg-accent" :style="{ width: `${(c.n / maxCubeta) * 100}%` }"></div>
                  </div>
                </div>
                <p class="text-2xs text-ink-faint pt-1">Días desde que se creó la tarea.</p>
              </div>

              <h2 class="text-sm font-semibold text-ink mt-4 mb-2 flex items-center gap-1.5">
                <IonIcon :icon="flagOutline" class="text-[15px] text-ink-faint" />
                Pendientes por prioridad
              </h2>
              <div class="ds-card p-4 space-y-2.5">
                <div v-for="p in [...data.prioridad].reverse()" :key="p.prioridad">
                  <div class="flex items-center justify-between text-xs mb-1">
                    <span class="flex items-center gap-1.5 text-ink-soft">
                      <BanderaPrioridad :prioridad="p.prioridad" :size="12" />
                      {{ PRIORIDADES[p.prioridad]?.label ?? p.prioridad }}
                    </span>
                    <span class="tnum text-ink">
                      {{ p.n }}
                      <span v-if="p.sinAsignar" class="text-ink-faint">· {{ p.sinAsignar }} sin responsable</span>
                    </span>
                  </div>
                  <div class="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div
                      class="h-full rounded-full"
                      :style="{ width: `${(p.n / maxPrioridad) * 100}%`, background: PRIORIDADES[p.prioridad]?.color }"
                    ></div>
                  </div>
                </div>
                <p class="text-2xs text-ink-faint pt-1 tnum">{{ totalPendientesPrioridad }} tareas pendientes en total.</p>
              </div>
            </div>

            <div>
              <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h2 class="text-sm font-semibold text-ink">
                  Sin movimiento
                  <span class="text-ink-faint font-normal tnum">· {{ data.antiguedad.totalEstancadas }}</span>
                </h2>
                <select
                  class="ds-input h-8 w-[130px]" aria-label="Días sin movimiento"
                  :value="estancadas" @change="setQuery({ estancadas: ($event.target as HTMLSelectElement).value })"
                >
                  <option v-for="d in [7, 14, 30, 60, 90]" :key="d" :value="d">+{{ d }} días</option>
                </select>
              </div>
              <div class="ds-card overflow-x-auto">
                <table class="ds-table">
                  <thead><tr><th class="w-9"><span class="sr-only">Prioridad</span></th><th>Tarea</th><th>Responsable</th><th>Quieta</th></tr></thead>
                  <tbody>
                    <tr v-for="t in data.antiguedad.estancadas" :key="t.id">
                      <td><BanderaPrioridad :prioridad="t.prioridad" :size="14" /></td>
                      <td>
                        <button class="font-medium text-ink hover:text-accent transition-colors text-left" @click="irALista(t.espacioId, t.listaId)">
                          {{ t.nombre }}
                        </button>
                        <p class="text-2xs text-ink-faint">{{ t.espacio }} · {{ t.lista }}</p>
                      </td>
                      <td class="text-ink-soft text-sm">{{ t.asignado ?? '—' }}</td>
                      <td class="tnum text-ink-soft text-sm">{{ t.dias }} d</td>
                    </tr>
                    <tr v-if="!data.antiguedad.estancadas.length">
                      <td colspan="4" class="text-xs text-ink-faint py-6 text-center">
                        Ninguna pendiente lleva más de {{ data.antiguedad.diasEstancada }} días sin movimiento.
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p
                  v-if="data.antiguedad.totalEstancadas > data.antiguedad.estancadas.length"
                  class="px-3 py-2 text-2xs text-ink-faint border-t border-line-soft"
                >
                  Se muestran las {{ data.antiguedad.estancadas.length }} más quietas de {{ data.antiguedad.totalEstancadas }}.
                </p>
              </div>
            </div>
          </section>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
/* Encabezado pegado dentro de una tabla con scroll vertical propio. */
.tabla-pegada thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgb(var(--s-surface));
}
.cat-tab {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px; border-radius: 8px; font-size: 13px; font-weight: 500;
  color: rgb(var(--s-ink-soft)); border: 1px solid rgb(var(--s-line));
  background: rgb(var(--s-surface));
  transition: background-color 0.12s ease, color 0.12s ease;
}
.cat-tab:hover { background: rgb(var(--s-surface-2)); }
.cat-activa {
  background: rgb(var(--s-accent-soft)); color: rgb(var(--s-accent-ink));
  border-color: rgb(var(--s-accent) / 0.3); font-weight: 600;
}
</style>
