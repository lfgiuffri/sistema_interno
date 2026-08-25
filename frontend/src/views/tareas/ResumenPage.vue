<script setup lang="ts">
/**
 * Resumen por categorías (pendientes / hoy / por vencer / vencidas) — SOLO LECTURA
 * a propósito (regla del legado). El número de cada tarjeta coincide con el listado
 * porque el backend usa la misma condición SQL para ambos.
 * `u`: mías (default) / todos / sin / id de otro usuario.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  onIonViewWillEnter, onIonViewWillLeave, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import { chevronBackOutline, peopleOutline, personOutline, funnelOutline } from 'ionicons/icons'
import { useTareasStore, ESTADOS_TAREA } from '@/stores/tareas'
import ThOrdenable from '@/components/shared/ThOrdenable.vue'
import { useOrdenTabla } from '@/composables/useOrdenTabla'
import { useToast } from '@/composables/useToast'
import { useTareasEnVivo } from '@/composables/useTareasEnVivo'
import { fecha as fmtFecha } from '@/composables/useFormato'
import BanderaPrioridad from '@/components/tareas/BanderaPrioridad.vue'

interface TareaResumen {
  id: number
  nombre: string
  prioridad: string
  estado: string
  fechaVencimiento?: string | null
  asignado?: { name: string; lastName: string } | null
}
interface Grupo {
  espacioId: number
  espacio: string
  listas: Array<{ listaId: number; lista: string; tareas: TareaResumen[] }>
}
interface Resumen {
  categoria: string
  alcance: string
  usuario: string | null
  dias: number
  conteos: Record<string, number>
  grupos: Grupo[]
  /** Catálogo del selector: TODOS los espacios visibles, filtre o no. */
  espacios: Array<{ id: number; nombre: string; activo: boolean }>
  espaciosFiltro: number[]
}

const CATEGORIAS: Record<string, { label: string; vacio: string }> = {
  pendientes: { label: 'Pendientes', vacio: 'No hay tareas pendientes.' },
  hoy: { label: 'Para hoy', vacio: 'No hay nada que venza hoy.' },
  por_vencer: { label: 'Por vencer', vacio: '' }, // se completa con los días
  vencidas: { label: 'Vencidas', vacio: 'No hay tareas vencidas. Al día.' },
  urgentes: { label: 'Urgentes', vacio: 'No hay tareas urgentes pendientes.' },
  sin_asignar: { label: 'Sin asignar', vacio: 'Todas las tareas pendientes tienen responsable.' },
}

const route = useRoute()
const router = useRouter()
const tareasStore = useTareasStore()
const toast = useToast()

const data = ref<Resumen | null>(null)
const loading = ref(false)

const categoria = computed(() => String(route.query.f ?? 'pendientes'))
const alcanceU = computed(() => String(route.query.u ?? ''))
const esEquipo = computed(() => alcanceU.value === 'todos')

/**
 * Filtro por espacio: MÚLTIPLE y en el query string (`e=1,4`), como los filtros del listado,
 * así el recorte se comparte por link. Vacío = todos los visibles.
 */
const filtroEspacios = computed<number[]>(() =>
  String(route.query.e ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0),
)
const panelEspacios = ref(false)

async function load(): Promise<void> {
  loading.value = true
  const r = await tareasStore
    .fetchResumen(categoria.value, alcanceU.value, filtroEspacios.value.join(','))
    .catch(() => null)
  loading.value = false
  if (!r) { toast.error('No se pudo cargar el resumen'); return }
  data.value = r
}

/** Cambia una clave del query conservando el resto (el filtro de espacios sobrevive). */
function setQuery(cambios: Record<string, string | undefined>): void {
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...cambios })) {
    if (v !== undefined && v !== null && v !== '') q[k] = String(v)
  }
  void router.replace({ query: q })
}

function ir(f: string): void {
  setQuery({ f })
}
function toggleEquipo(): void {
  setQuery({ f: categoria.value, u: esEquipo.value ? undefined : 'todos' })
}

function toggleEspacio(id: number): void {
  const act = filtroEspacios.value.includes(id)
    ? filtroEspacios.value.filter(x => x !== id)
    : [...filtroEspacios.value, id]
  setQuery({ e: act.join(',') || undefined })
}
function limpiarEspacios(): void {
  setQuery({ e: undefined })
}

/** Etiqueta del botón: sin filtro se dice «todos», con filtro se nombra el único elegido. */
const etiquetaEspacios = computed(() => {
  const n = filtroEspacios.value.length
  if (!n) return 'Todos los espacios'
  if (n === 1) {
    const e = data.value?.espacios.find(x => x.id === filtroEspacios.value[0])
    return e ? e.nombre : '1 espacio'
  }
  return `${n} espacios`
})

const mensajeVacio = computed(() => {
  if (!data.value) return ''
  if (data.value.categoria === 'por_vencer') return `No hay tareas por vencer en los próximos ${data.value.dias} días.`
  return CATEGORIAS[data.value.categoria]?.vacio ?? ''
})

/**
 * Las tareas vienen anidadas espacio → lista → tarea, pero la TABLA es plana: se aplana una
 * vez y cada sección filtra por su espacio. Sin esto no habría cómo ordenar por «Lista»,
 * que es justamente el criterio que agrupa.
 */
interface FilaResumen extends TareaResumen { espacioId: number; listaId: number; lista: string }
const filas = computed<FilaResumen[]>(() =>
  (data.value?.grupos ?? []).flatMap(g =>
    g.listas.flatMap(l => l.tareas.map(t => ({ ...t, espacioId: g.espacioId, listaId: l.listaId, lista: l.lista }))),
  ),
)

const orden = useOrdenTabla(
  filas,
  (f, col) => (col === 'asignado'
    ? (f.asignado ? `${f.asignado.name} ${f.asignado.lastName}` : null)
    : (f as unknown as Record<string, string | number | boolean | null>)[col]),
)

const hoyIso = new Date().toISOString().slice(0, 10)

const enVivo = useTareasEnVivo(() => load())

let loadedOnce = false
onMounted(() => { loadedOnce = true; void load(); enVivo.escuchar() })
onIonViewWillEnter(() => { if (loadedOnce) void load(); enVivo.escuchar() })
onIonViewWillLeave(() => enVivo.pausar())
watch(() => route.query, () => { if (loadedOnce && route.path.includes('/tareas/resumen')) void load() })
</script>

<template>
  <IonPage>
    <IonHeader class="ion-no-border">
      <IonToolbar class="app-toolbar">
        <IonButtons slot="start" class="lg:hidden"><IonMenuButton /></IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent class="page-content">
      <div class="max-w-5xl mx-auto px-5 lg:px-8 py-6 ds-enter">

        <button class="ds-btn-ghost h-8 -ml-2 mb-3" @click="router.push('/tareas')">
          <IonIcon :icon="chevronBackOutline" class="text-[14px]" />
          Tareas
        </button>

        <header class="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">
              {{ CATEGORIAS[categoria]?.label ?? 'Resumen' }}
              <span v-if="data" class="text-ink-faint font-normal tnum">· {{ data.conteos[data.categoria] }}</span>
            </h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              {{ data?.alcance === 'todos' ? 'Tareas de todo el equipo' : data?.alcance === 'usuario' ? `Tareas de ${data.usuario}` : data?.alcance === 'sin' ? 'Tareas sin responsable' : 'Tus tareas' }}
              — solo lectura.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="(data?.espacios.length ?? 0) > 1"
              class="ds-btn-secondary h-8"
              :class="{ 'border-accent/40 text-accent-ink bg-accent-soft': filtroEspacios.length }"
              :aria-expanded="panelEspacios" aria-controls="panel-espacios"
              @click="panelEspacios = !panelEspacios"
            >
              <IonIcon :icon="funnelOutline" class="text-[14px]" />
              {{ etiquetaEspacios }}
            </button>
            <button v-if="categoria !== 'sin_asignar'" class="ds-btn-secondary h-8" @click="toggleEquipo">
              <IonIcon :icon="esEquipo ? personOutline : peopleOutline" class="text-[14px]" />
              {{ esEquipo ? 'Ver las mías' : 'Ver el equipo' }}
            </button>
          </div>
        </header>

        <!--
          Filtro por espacio: checkboxes en una caja acotada (no un <select multiple>, que se
          recorta y en el celular exige Ctrl). Aplica al toque: recorta CONTEOS y listado a la
          vez, así el número de la solapa sigue siendo el de la tabla.
        -->
        <div v-if="panelEspacios && data" id="panel-espacios" class="ds-card p-4 mb-4 ds-enter">
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
          <p class="ds-hint">Sin nada tildado se ven todos los espacios que podés ver.</p>
        </div>

        <!-- Navegación entre categorías -->
        <div v-if="data" class="flex flex-wrap gap-1.5 mb-5">
          <button
            v-for="(meta, key) in CATEGORIAS"
            :key="key"
            class="cat-tab"
            :class="{ 'cat-activa': data.categoria === key }"
            @click="ir(key as string)"
          >
            {{ meta.label }}
            <span class="tnum opacity-70">{{ data.conteos[key] }}</span>
          </button>
        </div>

        <div v-if="loading && !data" class="space-y-3"><div v-for="i in 3" :key="i" class="ds-skeleton h-24"></div></div>

        <template v-if="data">
          <div v-if="data.grupos.length" class="space-y-5">
            <section v-for="g in data.grupos" :key="g.espacioId">
              <h2 class="text-sm font-semibold text-ink mb-2">{{ g.espacio }}</h2>
              <div class="ds-card overflow-x-auto">
                <table class="ds-table">
                  <thead>
                    <tr>
                      <th class="w-9"><span class="sr-only">Prioridad</span></th>
                      <ThOrdenable columna="nombre" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Tarea</ThOrdenable>
                      <ThOrdenable columna="lista" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Lista</ThOrdenable>
                      <ThOrdenable v-if="esEquipo || data.alcance === 'usuario'" columna="asignado" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Asignada a</ThOrdenable>
                      <ThOrdenable columna="fechaVencimiento" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Vencimiento</ThOrdenable>
                      <ThOrdenable columna="estado" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Estado</ThOrdenable>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="l in [g]" :key="l.espacioId">
                      <tr v-for="t in orden.ordenadas.value.filter(f => f.espacioId === g.espacioId)" :key="t.id">
                        <td><BanderaPrioridad :prioridad="t.prioridad" :size="14" /></td>
                        <td>
                          <button
                            class="font-medium text-ink hover:text-accent transition-colors text-left"
                            @click="router.push(`/tareas/espacios/${t.espacioId}/listas/${t.listaId}`)"
                          >{{ t.nombre }}</button>
                        </td>
                        <td class="text-ink-soft text-sm">{{ t.lista }}</td>
                        <td v-if="esEquipo || data.alcance === 'usuario'" class="text-ink-soft text-sm">
                          {{ t.asignado ? `${t.asignado.name} ${t.asignado.lastName}` : '—' }}
                        </td>
                        <td>
                          <div class="flex items-center gap-1.5">
                            <span class="tnum text-ink-soft">{{ fmtFecha(t.fechaVencimiento) }}</span>
                            <span v-if="t.fechaVencimiento && t.fechaVencimiento < hoyIso" class="ds-badge-danger">vencida</span>
                            <span v-else-if="t.fechaVencimiento === hoyIso" class="ds-badge-warn">hoy</span>
                          </div>
                        </td>
                        <td>
                          <span
                            class="inline-flex items-center gap-1.5 text-xs font-medium"
                            :style="{ color: ESTADOS_TAREA[t.estado]?.color }"
                          >
                            <span class="w-1.5 h-1.5 rounded-full" :style="{ background: ESTADOS_TAREA[t.estado]?.color }"></span>
                            {{ ESTADOS_TAREA[t.estado]?.label ?? t.estado }}
                          </span>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div v-else class="ds-card px-6 py-12 text-center">
            <p class="text-sm font-medium text-ink">{{ mensajeVacio }}</p>
            <p v-if="filtroEspacios.length" class="mt-1 text-xs text-ink-faint">
              Estás filtrando por {{ etiquetaEspacios.toLowerCase() }}.
              <button class="text-accent hover:underline" @click="limpiarEspacios">Ver todos</button>
            </p>
          </div>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
.cat-tab {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px; border-radius: 8px; font-size: 13px; font-weight: 500;
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
