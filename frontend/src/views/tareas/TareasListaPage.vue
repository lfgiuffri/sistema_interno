<script setup lang="ts">
/**
 * Pantalla central de tareas de una lista. Decisión clave del legado que se conserva:
 * los FILTROS viajan por query string (sobreviven a las mutaciones y se comparten por URL).
 * Tabla con bandera de prioridad, menú de estados, modal dual rápido/completo y mover.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  onIonViewWillEnter, onIonViewWillLeave, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  chevronBackOutline, addOutline, funnelOutline, createOutline, trashOutline,
  documentTextOutline, swapHorizontalOutline, checkboxOutline, listOutline, appsOutline,
} from 'ionicons/icons'
import { useTareasStore, ESTADOS_TAREA, PRIORIDADES, type TareaRow, type FiltrosTareas } from '@/stores/tareas'
import { useMeStore } from '@/stores/me'
import ThOrdenable from '@/components/shared/ThOrdenable.vue'
import { useOrdenTabla } from '@/composables/useOrdenTabla'
import { useToast } from '@/composables/useToast'
import { useTareasEnVivo } from '@/composables/useTareasEnVivo'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fecha as fmtFecha } from '@/composables/useFormato'
import BanderaPrioridad from '@/components/tareas/BanderaPrioridad.vue'
import EstadoMenu from '@/components/tareas/EstadoMenu.vue'
import TareaModal from '@/components/tareas/TareaModal.vue'

const route = useRoute()
const router = useRouter()
const tareasStore = useTareasStore()
const meStore = useMeStore()
const toast = useToast()

const espacioId = computed(() => Number(route.params.eid) || 0)
const listaId = computed(() => Number(route.params.lid) || 0)

const espacio = ref<{ id: number; nombre: string } | null>(null)
const lista = ref<{ id: number; nombre: string; activa: boolean } | null>(null)
const puedeEditar = ref(false)
const tareas = ref<TareaRow[]>([])

// La prioridad ya tiene su bandera y la lista viene con el orden del legado; el encabezado
// permite reordenar sobre eso. «Asignada a» ordena por el nombre visible, no por el id.
const orden = useOrdenTabla(
  () => tareas.value,
  (t, col) => (col === 'asignado'
    ? (t.asignado ? `${t.asignado.name} ${t.asignado.lastName}` : null)
    : (t as unknown as Record<string, string | number | boolean | null>)[col]),
)
const total = ref(0)
const loading = ref(false)
const asignables = ref<Array<{ id: number; nombre: string; username: string }>>([])

// ── Filtros (espejo de la query string) ──
const filtrosAbiertos = ref(false)
const f = ref({
  texto: '',
  estado: [] as string[],
  prioridad: [] as string[],
  asignadoA: '0',
  creadoPor: '0',
  vencDesde: '', vencHasta: '',
  inicioDesde: '', inicioHasta: '',
  creadaDesde: '', creadaHasta: '',
  soloVencidas: false,
  sinVencimiento: false,
  conDescripcion: false,
  incluirCompletadas: false,
})

/** Cuenta de filtros activos (los pares de fecha cuentan como 1 — regla del legado). */
const filtrosActivos = computed(() => {
  let n = 0
  if (f.value.texto) n++
  if (f.value.estado.length) n++
  if (f.value.prioridad.length) n++
  if (f.value.asignadoA !== '0') n++
  if (f.value.creadoPor !== '0') n++
  if (f.value.vencDesde || f.value.vencHasta) n++
  if (f.value.inicioDesde || f.value.inicioHasta) n++
  if (f.value.creadaDesde || f.value.creadaHasta) n++
  if (f.value.soloVencidas) n++
  if (f.value.sinVencimiento) n++
  if (f.value.conDescripcion) n++
  return n
})

/** route.query → estado local (para links compartidos / volver atrás). */
function leerQuery(): void {
  const q = route.query
  f.value = {
    texto: String(q.texto ?? ''),
    estado: String(q.estado ?? '').split(',').filter(Boolean),
    prioridad: String(q.prioridad ?? '').split(',').filter(Boolean),
    asignadoA: String(q.asignadoA ?? '0'),
    creadoPor: String(q.creadoPor ?? '0'),
    vencDesde: String(q.vencDesde ?? ''), vencHasta: String(q.vencHasta ?? ''),
    inicioDesde: String(q.inicioDesde ?? ''), inicioHasta: String(q.inicioHasta ?? ''),
    creadaDesde: String(q.creadaDesde ?? ''), creadaHasta: String(q.creadaHasta ?? ''),
    soloVencidas: q.soloVencidas === 'true',
    sinVencimiento: q.sinVencimiento === 'true',
    conDescripcion: q.conDescripcion === 'true',
    incluirCompletadas: q.incluirCompletadas === 'true',
  }
  filtrosAbiertos.value = filtrosActivos.value > 0
}

/** Estado local → query params para la API y la URL. */
function filtrosComoQuery(): FiltrosTareas {
  const v = f.value
  return {
    texto: v.texto || undefined,
    estado: v.estado.join(',') || undefined,
    prioridad: v.prioridad.join(',') || undefined,
    asignadoA: v.asignadoA !== '0' ? v.asignadoA : undefined,
    creadoPor: v.creadoPor !== '0' ? v.creadoPor : undefined,
    vencDesde: v.vencDesde || undefined, vencHasta: v.vencHasta || undefined,
    inicioDesde: v.inicioDesde || undefined, inicioHasta: v.inicioHasta || undefined,
    creadaDesde: v.creadaDesde || undefined, creadaHasta: v.creadaHasta || undefined,
    soloVencidas: v.soloVencidas ? 'true' : undefined,
    sinVencimiento: v.sinVencimiento ? 'true' : undefined,
    conDescripcion: v.conDescripcion ? 'true' : undefined,
    incluirCompletadas: v.incluirCompletadas ? 'true' : undefined,
  }
}

async function load(): Promise<void> {
  loading.value = true
  const data = await tareasStore.fetchTareas(espacioId.value, listaId.value, filtrosComoQuery()).catch(() => null)
  loading.value = false
  if (!data) { toast.error('Lista no encontrada en este espacio'); router.replace(`/tareas/espacios/${espacioId.value}`); return }
  espacio.value = data.espacio
  lista.value = data.lista
  // Para el selector de «crear en varias listas» del modal de alta.
  tareasStore.fetchListas(espacioId.value)
    .then(d => { listasDelEspacio.value = (d?.listas ?? []).filter(l => l.activa !== false) })
    .catch(() => { listasDelEspacio.value = [] })
  puedeEditar.value = data.puedeEditar
  tareas.value = data.tareas
  total.value = data.total
}

/** Aplica filtros: actualiza la URL (replace) y recarga. */
async function aplicar(): Promise<void> {
  await router.replace({ query: filtrosComoQuery() as Record<string, string> })
  await load()
}

async function limpiar(): Promise<void> {
  await router.replace({ query: {} })
  leerQuery()
  await load()
}

function togglePill(arr: string[], valor: string): void {
  const i = arr.indexOf(valor)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(valor)
}

async function toggleCompletadas(): Promise<void> {
  f.value.incluirCompletadas = !f.value.incluirCompletadas
  await aplicar()
}

// ── Vista tabla / kanban (mejora §10.11; la preferencia persiste) ──
const vista = ref<'tabla' | 'kanban'>((localStorage.getItem('tareas.vista') as 'tabla' | 'kanban') || 'tabla')
function setVista(v: 'tabla' | 'kanban'): void {
  vista.value = v
  localStorage.setItem('tareas.vista', v)
}
const porEstado = computed(() => {
  const cols: Record<string, TareaRow[]> = {}
  for (const key of Object.keys(ESTADOS_TAREA)) cols[key] = []
  for (const t of tareas.value) (cols[t.estado] ??= []).push(t)
  return cols
})
// DnD del kanban: arrastrar una card a otra columna cambia el estado.
const dragTarea = ref<TareaRow | null>(null)
const dragSobre = ref<string | null>(null)
function kanbanDragStart(t: TareaRow, e: DragEvent): void {
  if (!puedeEditar.value || !meStore.can('tareas:estado')) { e.preventDefault(); return }
  dragTarea.value = t
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function kanbanDragOver(estado: string, e: DragEvent): void {
  if (!dragTarea.value || dragTarea.value.estado === estado) return
  e.preventDefault()
  dragSobre.value = estado
}
async function kanbanDrop(estado: string): Promise<void> {
  const t = dragTarea.value
  dragTarea.value = null
  dragSobre.value = null
  if (!t || t.estado === estado) return
  await cambiarEstado(t, estado)
}

// ── Modal tarea ──
const modalTarea = ref(false)
const tareaEditando = ref<number | null>(null)
function abrirTarea(id: number | null): void {
  tareaEditando.value = id
  modalTarea.value = true
}

// ── Mover ──
const modalMover = ref(false)
const tareaMoviendo = ref<TareaRow | null>(null)
const espaciosDestino = ref<Array<{ id: number; nombre: string; editar: boolean }>>([])
const listasDestino = ref<Array<{ id: number; nombre: string }>>([])
/** Listas del espacio actual: el alta permite crear la misma tarea en varias de una vez. */
const listasDelEspacio = ref<Array<{ id: number; nombre: string }>>([])
const destino = ref({ espacioId: 0, listaId: 0 })
const moverError = ref('')
useEscapeToClose(modalMover, () => { modalMover.value = false })

async function abrirMover(t: TareaRow): Promise<void> {
  tareaMoviendo.value = t
  moverError.value = ''
  if (!tareasStore.homeEspacios.length) await tareasStore.fetchHome()
  espaciosDestino.value = tareasStore.homeEspacios.filter(e => e.editar)
  destino.value = { espacioId: espacioId.value, listaId: 0 }
  await cargarListasDestino()
  modalMover.value = true
}

async function cargarListasDestino(): Promise<void> {
  const data = await tareasStore.fetchListas(destino.value.espacioId).catch(() => null)
  listasDestino.value = (data?.listas ?? []).filter(l => l.id !== listaId.value || destino.value.espacioId !== espacioId.value)
  destino.value.listaId = listasDestino.value[0]?.id ?? 0
}

async function confirmarMover(): Promise<void> {
  if (!tareaMoviendo.value || !destino.value.listaId) return
  const r = await tareasStore.moverTarea(tareaMoviendo.value.id, destino.value.listaId)
  if (!r.ok) { moverError.value = r.message; return }
  toast.success('Tarea movida')
  modalMover.value = false
  await load()
}

// ── Acciones de fila ──
async function cambiarEstado(t: TareaRow, estado: string): Promise<void> {
  const r = await tareasStore.cambiarEstado(t.id, estado)
  if (!r.ok) { toast.error(r.message); return }
  toast.success(`Estado actualizado: ${ESTADOS_TAREA[estado]?.label ?? estado}`)
  await load()
}

async function confirmDelete(t: TareaRow): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar tarea',
    message: `¿Eliminar «${t.nombre}»?`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await tareasStore.removeTarea(t.id)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Tarea eliminada')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

const vencida = (t: TareaRow) =>
  !!t.fechaVencimiento && t.estado !== 'completada' && t.fechaVencimiento < new Date().toISOString().slice(0, 10)

// Si otro usuario toca una tarea, el listado se actualiza solo (Socket.IO).
const enVivo = useTareasEnVivo(() => load())

let loadedOnce = false
onMounted(async () => {
  loadedOnce = true
  leerQuery()
  await Promise.all([load(), tareasStore.fetchAsignables().then(a => { asignables.value = a })])
  enVivo.escuchar()
})
onIonViewWillEnter(() => { if (loadedOnce) void load(); enVivo.escuchar() })
onIonViewWillLeave(() => enVivo.pausar())
// Cambiar de lista con la misma vista montada (navegación lateral).
watch([espacioId, listaId], () => { if (loadedOnce && espacioId.value && listaId.value) { leerQuery(); void load() } })
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

        <button class="ds-btn-ghost h-8 -ml-2 mb-3" @click="router.push(`/tareas/espacios/${espacioId}`)">
          <IonIcon :icon="chevronBackOutline" class="text-[14px]" />
          {{ espacio?.nombre ?? 'Listas' }}
        </button>

        <header class="flex items-center justify-between gap-4 pb-4">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">
              {{ lista?.nombre ?? '…' }}
              <span v-if="lista && !lista.activa" class="ds-badge-neutral align-middle ml-1">Inactiva</span>
            </h1>
            <p class="mt-0.5 text-sm text-ink-soft tnum">
              {{ filtrosActivos ? `${total} tarea(s) con los filtros puestos` : (f.incluirCompletadas ? `${total} tarea(s)` : 'Mostrando solo las pendientes') }}
            </p>
          </div>
          <button v-if="puedeEditar && meStore.can('tareas:create')" class="ds-btn-primary" @click="abrirTarea(null)">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nueva tarea
          </button>
        </header>

        <!-- Barra de filtros -->
        <div class="flex items-center gap-2 mb-3">
          <button class="ds-btn-secondary h-8" @click="filtrosAbiertos = !filtrosAbiertos">
            <IonIcon :icon="funnelOutline" class="text-[14px]" />
            Filtros
            <span v-if="filtrosActivos" class="ds-badge-accent !h-[16px] !text-2xs ml-1 tnum">{{ filtrosActivos }}</span>
          </button>
          <button class="ds-btn-ghost h-8 text-xs" @click="toggleCompletadas">
            <IonIcon :icon="checkboxOutline" class="text-[14px]" />
            {{ f.incluirCompletadas ? 'Ocultar completadas' : 'Ver completadas' }}
          </button>
          <div class="flex-1"></div>
          <div class="flex rounded-lg border border-line overflow-hidden" role="group" aria-label="Vista">
            <button
              class="h-8 px-2.5 text-xs flex items-center gap-1 transition-colors"
              :class="vista === 'tabla' ? 'bg-accent-soft text-accent-ink font-medium' : 'text-ink-soft hover:bg-surface-2'"
              @click="setVista('tabla')"
            >
              <IonIcon :icon="listOutline" class="text-[13px]" /> Tabla
            </button>
            <button
              class="h-8 px-2.5 text-xs flex items-center gap-1 transition-colors border-l border-line"
              :class="vista === 'kanban' ? 'bg-accent-soft text-accent-ink font-medium' : 'text-ink-soft hover:bg-surface-2'"
              @click="setVista('kanban')"
            >
              <IonIcon :icon="appsOutline" class="text-[13px]" /> Kanban
            </button>
          </div>
        </div>

        <!-- Panel de filtros -->
        <div v-if="filtrosAbiertos" class="ds-card p-4 mb-4 ds-enter">
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label class="ds-label" for="ft-texto">Texto</label>
              <input id="ft-texto" v-model="f.texto" class="ds-input h-8" type="search" placeholder="Nombre o descripción…" maxlength="100" @keyup.enter="aplicar" />
            </div>
            <div>
              <span class="ds-label">Estado</span>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="(meta, key) in ESTADOS_TAREA" :key="key" type="button"
                  class="pill-mini" :class="{ 'pill-mini-activa': f.estado.includes(key as string) }"
                  :style="{ '--c': meta.color }" @click="togglePill(f.estado, key as string)"
                >{{ meta.label }}</button>
              </div>
            </div>
            <div>
              <span class="ds-label">Prioridad</span>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="(meta, key) in PRIORIDADES" :key="key" type="button"
                  class="pill-mini" :class="{ 'pill-mini-activa': f.prioridad.includes(key as string) }"
                  :style="{ '--c': meta.color }" @click="togglePill(f.prioridad, key as string)"
                >{{ meta.label }}</button>
              </div>
            </div>
            <div>
              <label class="ds-label" for="ft-asignado">Asignada a</label>
              <select id="ft-asignado" v-model="f.asignadoA" class="ds-input h-8">
                <option value="0">Cualquiera</option>
                <option value="-1">Sin asignar</option>
                <option v-for="a in asignables" :key="a.id" :value="String(a.id)">
                  {{ a.nombre }}{{ a.id === meStore.user?.id ? ' (vos)' : '' }}
                </option>
              </select>
            </div>
            <div>
              <label class="ds-label" for="ft-venc-d">Vencimiento</label>
              <div class="flex items-center gap-1">
                <input id="ft-venc-d" v-model="f.vencDesde" class="ds-input h-8" type="date" aria-label="Vencimiento desde" />
                <span class="text-ink-faint text-xs">a</span>
                <input v-model="f.vencHasta" class="ds-input h-8" type="date" aria-label="Vencimiento hasta" />
              </div>
            </div>
            <div>
              <label class="ds-label" for="ft-creada-d">Creada</label>
              <div class="flex items-center gap-1">
                <input id="ft-creada-d" v-model="f.creadaDesde" class="ds-input h-8" type="date" aria-label="Creada desde" />
                <span class="text-ink-faint text-xs">a</span>
                <input v-model="f.creadaHasta" class="ds-input h-8" type="date" aria-label="Creada hasta" />
              </div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-line-soft">
            <label class="flex items-center gap-1.5 text-xs text-ink cursor-pointer">
              <input v-model="f.soloVencidas" type="checkbox" class="accent-[#0F7660]" /> Solo vencidas
            </label>
            <label class="flex items-center gap-1.5 text-xs text-ink cursor-pointer">
              <input v-model="f.sinVencimiento" type="checkbox" class="accent-[#0F7660]" /> Sin vencimiento
            </label>
            <label class="flex items-center gap-1.5 text-xs text-ink cursor-pointer">
              <input v-model="f.conDescripcion" type="checkbox" class="accent-[#0F7660]" /> Con descripción
            </label>
            <div class="flex-1"></div>
            <button class="ds-btn-ghost h-7 px-2.5 text-xs" @click="limpiar">Limpiar</button>
            <button class="ds-btn-primary h-7 px-3 text-xs" @click="aplicar">Aplicar</button>
          </div>
        </div>

        <!-- Kanban (mejora §10.11): columnas por estado, arrastrar cambia el estado -->
        <div v-if="vista === 'kanban'" class="grid grid-cols-2 lg:grid-cols-5 gap-3 items-start">
          <div
            v-for="(meta, estado) in ESTADOS_TAREA"
            :key="estado"
            class="kanban-col"
            :class="{ 'kanban-drop': dragSobre === estado && dragTarea }"
            @dragover="kanbanDragOver(estado as string, $event)"
            @dragleave="dragSobre = null"
            @drop="kanbanDrop(estado as string)"
          >
            <div class="flex items-center gap-1.5 px-1 pb-2">
              <span class="w-2 h-2 rounded-full" :style="{ background: meta.color }"></span>
              <span class="text-xs font-semibold text-ink">{{ meta.label }}</span>
              <span class="text-2xs text-ink-faint tnum ml-auto">{{ porEstado[estado]?.length || 0 }}</span>
            </div>
            <div class="space-y-2 min-h-[60px]">
              <div
                v-for="t in porEstado[estado]"
                :key="t.id"
                class="kanban-card"
                :draggable="puedeEditar && meStore.can('tareas:estado')"
                @dragstart="kanbanDragStart(t, $event)"
                @dragend="dragTarea = null; dragSobre = null"
                @click="abrirTarea(t.id)"
              >
                <div class="flex items-start gap-1.5">
                  <BanderaPrioridad :prioridad="t.prioridad" :size="12" />
                  <p class="text-xs font-medium text-ink flex-1 leading-snug">{{ t.nombre }}</p>
                </div>
                <div class="flex items-center gap-1.5 mt-1.5">
                  <span v-if="t.asignado" class="text-2xs text-ink-faint truncate">{{ t.asignado.name }}</span>
                  <span class="flex-1"></span>
                  <span v-if="vencida(t)" class="ds-badge-danger !h-[16px] !text-2xs">vencida</span>
                  <span v-else-if="t.fechaVencimiento" class="text-2xs text-ink-faint tnum">{{ fmtFecha(t.fechaVencimiento) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Tabla -->
        <div v-if="vista === 'tabla'" class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th class="w-9"><span class="sr-only">Prioridad</span></th>
                <ThOrdenable columna="nombre" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Tarea</ThOrdenable>
                <ThOrdenable columna="asignado" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Asignada a</ThOrdenable>
                <ThOrdenable columna="fechaVencimiento" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Vencimiento</ThOrdenable>
                <ThOrdenable columna="estado" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Estado</ThOrdenable>
                <ThOrdenable columna="createdAt" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Creada</ThOrdenable>
                <th class="w-24"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="loading && !tareas.length">
              <tr v-for="i in 5" :key="i"><td colspan="7" class="!px-3"><div class="ds-skeleton h-5 w-full my-2"></div></td></tr>
            </tbody>

            <tbody v-else-if="tareas.length">
              <tr
                v-for="t in orden.ordenadas.value" :key="t.id"
                class="fila-estado" :class="{ 'opacity-55': t.estado === 'completada' }"
                :style="{ '--fila': ESTADOS_TAREA[t.estado]?.color }"
              >
                <td><BanderaPrioridad :prioridad="t.prioridad" :size="15" /></td>
                <td>
                  <button class="text-left group flex items-center gap-1.5" @click="abrirTarea(t.id)">
                    <span class="font-medium text-ink group-hover:text-accent transition-colors">{{ t.nombre }}</span>
                    <IonIcon v-if="t.tieneDescripcion" :icon="documentTextOutline" class="text-[12px] text-ink-faint shrink-0" title="Tiene descripción" />
                  </button>
                  <p v-if="t.fechaInicio" class="text-2xs text-ink-faint">desde {{ fmtFecha(t.fechaInicio) }}</p>
                </td>
                <td class="text-ink-soft text-sm">
                  {{ t.asignado ? `${t.asignado.name} ${t.asignado.lastName}` : '—' }}
                </td>
                <td>
                  <div class="flex items-center gap-1.5">
                    <span class="tnum text-ink-soft">{{ fmtFecha(t.fechaVencimiento) }}</span>
                    <span v-if="vencida(t)" class="ds-badge-danger">vencida</span>
                  </div>
                </td>
                <td>
                  <EstadoMenu :estado="t.estado" :editable="puedeEditar && meStore.can('tareas:estado')" @cambiar="cambiarEstado(t, $event)" />
                </td>
                <td class="tnum text-ink-faint text-xs">{{ fmtFecha(t.createdAt) }}</td>
                <td>
                  <div v-if="puedeEditar" class="flex items-center justify-end gap-0.5">
                    <button v-if="meStore.can('tareas:update')" class="row-action" title="Editar" aria-label="Editar" @click="abrirTarea(t.id)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('tareas:update')" class="row-action" title="Mover de lista" aria-label="Mover de lista" @click="abrirMover(t)">
                      <IonIcon :icon="swapHorizontalOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('tareas:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="confirmDelete(t)">
                      <IonIcon :icon="trashOutline" class="text-[15px]" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>

            <tbody v-else>
              <tr>
                <td colspan="7" class="!h-auto">
                  <div class="flex flex-col items-center py-12 text-center">
                    <p class="text-sm font-medium text-ink">{{ filtrosActivos ? 'Sin tareas con estos filtros' : 'No hay tareas pendientes en esta lista' }}</p>
                    <p class="text-xs text-ink-faint mt-1">{{ filtrosActivos ? 'Probá con «Limpiar».' : (puedeEditar ? 'Creá la primera con «Nueva tarea».' : '') }}</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <TareaModal
        :open="modalTarea"
        :lista-id="listaId"
        :lista-nombre="lista?.nombre ?? ''"
        :listas-del-espacio="listasDelEspacio"
        :tarea-id="tareaEditando"
        :asignables="asignables"
        @close="modalTarea = false"
        @saved="load()"
      />

      <!-- Modal mover -->
      <Teleport defer to="ion-app">
        <div v-if="modalMover" class="ds-modal-backdrop" @click.self="modalMover = false">
          <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-label="Mover tarea">
            <h2 class="text-base font-semibold text-ink mb-1">Mover «{{ tareaMoviendo?.nombre }}»</h2>
            <p class="text-xs text-ink-soft mb-4">A otra lista, incluso de otro espacio (necesitás poder editar en ambos).</p>
            <form class="space-y-3" @submit.prevent="confirmarMover">
              <div>
                <label class="ds-label" for="mv-espacio">Espacio destino</label>
                <select id="mv-espacio" v-model.number="destino.espacioId" class="ds-input" @change="cargarListasDestino">
                  <option v-for="e in espaciosDestino" :key="e.id" :value="e.id">{{ e.nombre }}</option>
                </select>
              </div>
              <div>
                <label class="ds-label" for="mv-lista">Lista destino</label>
                <select id="mv-lista" v-model.number="destino.listaId" class="ds-input">
                  <option v-if="!listasDestino.length" :value="0" disabled>No hay otras listas</option>
                  <option v-for="l in listasDestino" :key="l.id" :value="l.id">{{ l.nombre }}</option>
                </select>
              </div>
              <p v-if="moverError" class="ds-error" role="alert">{{ moverError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalMover = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!destino.listaId">Mover</button>
              </footer>
            </form>
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

/* Filete de color por estado (est-* del legado). */
.fila-estado td:first-child { box-shadow: inset 3px 0 0 var(--fila); }

.pill-mini {
  height: 22px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 500;
  color: var(--c); background: color-mix(in srgb, var(--c) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 25%, transparent);
}
.pill-mini-activa { background: var(--c); color: white; border-color: var(--c); }

.kanban-col {
  background: rgb(var(--s-surface-2) / 0.45);
  border: 1px solid rgb(var(--s-line-soft));
  border-radius: 12px;
  padding: 10px 8px 8px;
}
.kanban-drop { outline: 2px dashed rgb(var(--s-accent)); outline-offset: -3px; }
.kanban-card {
  background: rgb(var(--s-surface));
  border: 1px solid rgb(var(--s-line));
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
  transition: box-shadow 0.12s ease, transform 0.1s ease;
}
.kanban-card:hover { box-shadow: 0 2px 8px rgb(0 0 0 / 0.06); }
.kanban-card:active { transform: scale(0.99); }
.kanban-card[draggable='true'] { cursor: grab; }
</style>
