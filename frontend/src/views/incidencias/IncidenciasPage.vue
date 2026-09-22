<script setup lang="ts">
/**
 * Incidencias — lo que reportan los clientes, visto desde el sistema interno.
 *
 * Tres cosas se hacen desde acá: cargar una incidencia en nombre de un cliente (cuando llama
 * por teléfono en vez de usar el portal), mover el estado, y **convertirla en una tarea**.
 *
 * Al crear la tarea, el estado de la incidencia pasa a ser DERIVADO: lo maneja la tarea, y el
 * selector se apaga ENTERO y lo dice. No queda escape manual: un botón que el próximo cambio
 * de la tarea pisa sin explicación es peor que no tener botón. Para moverlo a mano hay que
 * mover la tarea.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  addOutline, closeOutline, documentAttachOutline, chevronDownOutline, trashOutline,
  gitBranchOutline, openOutline, createOutline,
} from 'ionicons/icons'
import { useIncidenciasStore, ESTADOS_INCIDENCIA, ESTADOS_TERMINADOS, type IncidenciaRow } from '@/stores/incidencias'
import { useTareasStore } from '@/stores/tareas'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fecha as fmtFecha } from '@/composables/useFormato'
import api from '@/services/api'

const router = useRouter()
const store = useIncidenciasStore()
const tareasStore = useTareasStore()
const meStore = useMeStore()
const toast = useToast()

const clientes = ref<Array<{ id: number; nombre: string }>>([])
const filtros = ref({ clienteId: 0, estado: '', texto: '', incluirCerradas: true })

const abierta = ref<number | null>(null)
const detalles = ref<Record<number, IncidenciaRow>>({})

async function load(): Promise<void> {
  await store.fetchIncidencias({
    clienteId: filtros.value.clienteId || undefined,
    estado: filtros.value.estado || undefined,
    texto: filtros.value.texto || undefined,
    incluirCerradas: filtros.value.incluirCerradas ? undefined : 'false',
  })
}

async function abrirDetalle(i: IncidenciaRow): Promise<void> {
  if (abierta.value === i.id) { abierta.value = null; return }
  abierta.value = i.id
  const d = await store.fetchIncidencia(i.id)
  if (d) detalles.value = { ...detalles.value, [i.id]: d }
}

// ── Alta en nombre del cliente ──
const modalAlta = ref(false)
const guardando = ref(false)
const formError = ref('')
const form = ref({ clienteId: 0, servicioId: 0, titulo: '', descripcion: '' })
const serviciosDelCliente = ref<Array<{ id: number; nombre: string }>>([])
useEscapeToClose(modalAlta, () => { modalAlta.value = false })

async function onClienteElegido(): Promise<void> {
  form.value.servicioId = 0
  serviciosDelCliente.value = form.value.clienteId
    ? await store.fetchServicios(form.value.clienteId)
    : []
}

function abrirAlta(): void {
  form.value = { clienteId: 0, servicioId: 0, titulo: '', descripcion: '' }
  serviciosDelCliente.value = []
  formError.value = ''
  modalAlta.value = true
}

async function guardarAlta(): Promise<void> {
  if (!form.value.clienteId || !form.value.titulo.trim()) return
  guardando.value = true
  formError.value = ''
  const r = await store.crear({
    clienteId: form.value.clienteId,
    servicioId: form.value.servicioId || null,
    titulo: form.value.titulo.trim(),
    descripcion: form.value.descripcion.trim() || undefined,
  })
  guardando.value = false
  if (!r.ok) { formError.value = r.message; return }
  modalAlta.value = false
  toast.success('Incidencia cargada')
  await load()
}

// ── Estado ──
async function cambiarEstado(i: IncidenciaRow, estado: string): Promise<void> {
  const r = await store.cambiarEstado(i.id, estado)
  if (!r.ok) { toast.error(r.message); return }
  toast.success(`Incidencia ${ESTADOS_INCIDENCIA[estado]?.label.toLowerCase() ?? estado}`)
  await load()
  if (abierta.value === i.id) await abrirDetalle({ ...i, id: i.id } as IncidenciaRow).catch(() => null)
}

// ── Crear tarea ──
const modalTarea = ref(false)
const incidenciaParaTarea = ref<IncidenciaRow | null>(null)
const espacios = ref<Array<{ id: number; nombre: string; editar: boolean }>>([])
const listas = ref<Array<{ id: number; nombre: string }>>([])
const destino = ref({ espacioId: 0, listaId: 0, fechaVencimiento: '' })
const creandoTarea = ref(false)
const tareaError = ref('')
useEscapeToClose(modalTarea, () => { modalTarea.value = false })

async function abrirCrearTarea(i: IncidenciaRow): Promise<void> {
  incidenciaParaTarea.value = i
  tareaError.value = ''
  if (!tareasStore.homeEspacios.length) await tareasStore.fetchHome()
  espacios.value = tareasStore.homeEspacios.filter(e => e.editar)
  destino.value = { espacioId: espacios.value[0]?.id ?? 0, listaId: 0, fechaVencimiento: '' }
  await cargarListas()
  modalTarea.value = true
}

async function cargarListas(): Promise<void> {
  if (!destino.value.espacioId) { listas.value = []; return }
  const data = await tareasStore.fetchListas(destino.value.espacioId).catch(() => null)
  listas.value = (data?.listas ?? []).filter((l: { activa?: boolean }) => l.activa !== false)
  destino.value.listaId = listas.value[0]?.id ?? 0
}

async function confirmarCrearTarea(): Promise<void> {
  if (!incidenciaParaTarea.value || !destino.value.listaId) return
  creandoTarea.value = true
  const r = await store.crearTarea(incidenciaParaTarea.value.id, destino.value.listaId, destino.value.fechaVencimiento)
  creandoTarea.value = false
  if (!r.ok) { tareaError.value = r.message; return }
  modalTarea.value = false
  const d = r.data as { archivosCopiados?: number } | undefined
  toast.success(d?.archivosCopiados
    ? `Tarea creada con ${d.archivosCopiados} adjunto(s)`
    : 'Tarea creada')
  await load()
}

async function confirmarEliminar(i: IncidenciaRow): Promise<void> {
  const alert = await alertController.create({
    backdropDismiss: false,
    header: 'Eliminar incidencia',
    message: `¿Eliminar «${i.titulo}»? El cliente deja de verla en su portal.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await store.eliminar(i.id)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Incidencia eliminada')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

/** Con tarea vinculada el estado es DERIVADO: no se toca desde acá, se mueve la tarea. */
const estadoEditable = (i: IncidenciaRow): boolean => !i.tareaId

const pendientes = computed(() => store.rows.filter(i => !ESTADOS_TERMINADOS.includes(i.estado)))
const terminadas = computed(() => store.rows.filter(i => ESTADOS_TERMINADOS.includes(i.estado)))

let loadedOnce = false
onMounted(async () => {
  loadedOnce = true
  const { data } = await api.get('/clientes', { params: { activo: 'true' } }).catch(() => ({ data: { success: false } }))
  if (data.success) clientes.value = data.data.map((c: { id: number; nombre: string }) => ({ id: c.id, nombre: c.nombre }))
  await load()
})
onIonViewWillEnter(() => { if (loadedOnce) void load() })
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

        <header class="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Incidencias</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Lo que reportan los clientes desde su portal.</p>
          </div>
          <button v-if="meStore.can('incidencias:create')" class="ds-btn-primary h-9" @click="abrirAlta">
            <IonIcon :icon="addOutline" class="text-[16px]" /> Cargar incidencia
          </button>
        </header>

        <div class="ds-card p-4 mb-4">
          <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label class="ds-label" for="f-cliente">Cliente</label>
              <select id="f-cliente" v-model.number="filtros.clienteId" class="ds-input h-8" @change="load">
                <option :value="0">Todos</option>
                <option v-for="c in clientes" :key="c.id" :value="c.id">{{ c.nombre }}</option>
              </select>
            </div>
            <div>
              <label class="ds-label" for="f-estado">Estado</label>
              <select id="f-estado" v-model="filtros.estado" class="ds-input h-8" @change="load">
                <option value="">Todos</option>
                <option v-for="(meta, key) in ESTADOS_INCIDENCIA" :key="key" :value="key">{{ meta.label }}</option>
              </select>
            </div>
            <div class="lg:col-span-2">
              <label class="ds-label" for="f-texto">Buscar</label>
              <input
                id="f-texto" v-model="filtros.texto" class="ds-input h-8" type="search"
                placeholder="Título o descripción…" maxlength="100" @keyup.enter="load"
              />
            </div>
          </div>
        </div>

        <div v-if="store.loading && !store.rows.length" class="space-y-2">
          <div v-for="i in 4" :key="i" class="ds-skeleton h-20"></div>
        </div>

        <div v-else-if="store.rows.length" class="space-y-5">
          <section v-for="grupo in [
            { titulo: 'Abiertas', items: pendientes },
            { titulo: 'Resueltas', items: terminadas },
          ]" :key="grupo.titulo">
            <h2 v-if="grupo.items.length" class="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">
              {{ grupo.titulo }} <span class="tnum">· {{ grupo.items.length }}</span>
            </h2>
            <div v-if="grupo.items.length" class="space-y-2">
              <article v-for="i in grupo.items" :key="i.id" class="ds-card overflow-hidden">
                <div class="px-4 py-3">
                  <div class="flex items-start gap-3">
                    <button class="min-w-0 flex-1 text-left" @click="abrirDetalle(i)">
                      <p class="font-medium text-ink break-words">{{ i.titulo }}</p>
                      <p class="mt-0.5 text-2xs text-ink-faint">
                        {{ i.cliente?.nombre }} · {{ fmtFecha(i.createdAt) }}
                        <span v-if="i.servicio"> · {{ i.servicio.nombre }}</span>
                        <span v-else> · Consulta general</span>
                      </p>
                    </button>

                    <span
                      class="ds-badge shrink-0"
                      :style="{
                        color: ESTADOS_INCIDENCIA[i.estado]?.color,
                        borderColor: `${ESTADOS_INCIDENCIA[i.estado]?.color}33`,
                        background: `${ESTADOS_INCIDENCIA[i.estado]?.color}14`,
                      }"
                    >{{ ESTADOS_INCIDENCIA[i.estado]?.label ?? i.estado }}</span>

                    <span v-if="i.tareaId" class="ds-badge-accent shrink-0" title="Tiene una tarea vinculada">
                      <IonIcon :icon="gitBranchOutline" class="text-[11px]" /> con tarea
                    </span>

                    <div class="flex items-center gap-0.5 shrink-0">
                      <button
                        v-if="!i.tareaId && meStore.can('tareas:create')" class="row-action"
                        title="Crear una tarea a partir de esta incidencia" aria-label="Crear tarea"
                        @click="abrirCrearTarea(i)"
                      >
                        <IonIcon :icon="gitBranchOutline" class="text-[15px]" />
                      </button>
                      <button
                        v-if="i.tarea" class="row-action" title="Ir a la tarea" aria-label="Ir a la tarea"
                        @click="router.push(`/tareas/espacios/${i.tarea.espacioId}/listas/${i.tarea.listaId}`)"
                      >
                        <IonIcon :icon="openOutline" class="text-[15px]" />
                      </button>
                      <button
                        v-if="meStore.can('incidencias:delete')" class="row-action hover:!text-danger"
                        title="Eliminar" aria-label="Eliminar" @click="confirmarEliminar(i)"
                      >
                        <IonIcon :icon="trashOutline" class="text-[15px]" />
                      </button>
                      <button class="row-action" :aria-label="`Ver ${i.titulo}`" @click="abrirDetalle(i)">
                        <IonIcon
                          :icon="chevronDownOutline" class="text-[15px] transition-transform"
                          :class="{ 'rotate-180': abierta === i.id }"
                        />
                      </button>
                    </div>
                  </div>

                  <!-- Estado: pastillas. Con tarea vinculada se apagan todas (lo manda la tarea). -->
                  <div v-if="meStore.can('incidencias:estado')" class="flex flex-wrap items-center gap-1 mt-2">
                    <span class="text-2xs text-ink-faint mr-1">Estado</span>
                    <button
                      v-for="(meta, key) in ESTADOS_INCIDENCIA" :key="key" type="button"
                      class="ds-pill"
                      :class="{ 'ds-pill-activa': i.estado === key }"
                      :style="{ '--c': meta.color }"
                      :disabled="!estadoEditable(i) || i.estado === key"
                      :title="!estadoEditable(i) ? 'Lo maneja la tarea vinculada' : ''"
                      @click="cambiarEstado(i, key as string)"
                    >{{ meta.label }}</button>
                  </div>
                  <p v-if="i.tareaId" class="mt-1 text-2xs text-ink-faint">
                    El estado lo marca la tarea vinculada.
                    <span v-if="i.fechaEstimada">El cliente ve «{{ fmtFecha(i.fechaEstimada) }}» como fecha estimada.</span>
                  </p>
                </div>

                <div v-if="abierta === i.id" class="px-4 pb-4 border-t border-line-soft pt-3">
                  <p v-if="detalles[i.id]?.descripcion" class="text-sm text-ink-soft whitespace-pre-wrap break-words">
                    {{ detalles[i.id].descripcion }}
                  </p>
                  <p v-else class="text-sm text-ink-faint">Sin descripción.</p>

                  <div v-if="detalles[i.id]?.archivos?.length" class="mt-3 flex flex-wrap gap-1.5">
                    <span v-for="a in detalles[i.id].archivos" :key="a.id" class="ds-badge-neutral max-w-full">
                      <IonIcon :icon="documentAttachOutline" class="text-[11px] shrink-0" />
                      <span class="truncate">{{ a.nombreOriginal }}</span>
                    </span>
                  </div>

                  <div v-if="detalles[i.id]?.historial?.length" class="mt-3 pt-3 border-t border-line-soft">
                    <p class="text-2xs font-medium text-ink-faint mb-1.5">Historial</p>
                    <ul class="space-y-1">
                      <li v-for="h in detalles[i.id].historial" :key="h.id" class="text-2xs text-ink-soft">
                        <span class="tnum text-ink-faint">{{ fmtFecha(h.createdAt) }}</span>
                        — {{ h.evento === 'creada' ? 'Se cargó' : `Pasó a ${(ESTADOS_INCIDENCIA[h.evento]?.label ?? h.evento).toLowerCase()}` }}
                        <span v-if="h.detalle" class="text-ink-faint">({{ h.detalle }})</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div v-else class="ds-card px-6 py-12 text-center">
          <p class="text-sm font-medium text-ink">No hay incidencias con estos filtros.</p>
          <p class="text-xs text-ink-faint mt-1">Van a aparecer acá cuando un cliente cargue una desde su portal.</p>
        </div>
      </div>

      <!-- Alta en nombre del cliente -->
      <Teleport to="body">
        <div v-if="modalAlta" class="ds-modal-backdrop">
          <div class="ds-modal" role="dialog" aria-modal="true" aria-label="Cargar incidencia">
            <div class="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 class="text-base font-semibold text-ink">Cargar incidencia</h2>
                <p class="text-xs text-ink-soft">En nombre de un cliente (si te llamó en vez de usar el portal).</p>
              </div>
              <button class="row-action" aria-label="Cerrar" @click="modalAlta = false">
                <IonIcon :icon="closeOutline" class="text-[16px]" />
              </button>
            </div>

            <form class="space-y-3" @submit.prevent="guardarAlta">
              <div>
                <label class="ds-label" for="a-cliente">Cliente</label>
                <select id="a-cliente" v-model.number="form.clienteId" class="ds-input" @change="onClienteElegido">
                  <option :value="0" disabled>Elegí el cliente</option>
                  <option v-for="c in clientes" :key="c.id" :value="c.id">{{ c.nombre }}</option>
                </select>
              </div>
              <div v-if="form.clienteId">
                <label class="ds-label" for="a-servicio">Servicio</label>
                <select id="a-servicio" v-model.number="form.servicioId" class="ds-input">
                  <option :value="0">Consulta general</option>
                  <option v-for="s in serviciosDelCliente" :key="s.id" :value="s.id">{{ s.nombre }}</option>
                </select>
                <p v-if="!serviciosDelCliente.length" class="ds-hint">
                  Este cliente no tiene abonos activos ni proyectos con servicio: queda como consulta general.
                </p>
              </div>
              <div>
                <label class="ds-label" for="a-titulo">Título</label>
                <input id="a-titulo" v-model="form.titulo" class="ds-input" maxlength="200" />
              </div>
              <div>
                <label class="ds-label" for="a-desc">Descripción</label>
                <textarea id="a-desc" v-model="form.descripcion" class="ds-input !h-auto py-2" rows="4" maxlength="20000"></textarea>
              </div>

              <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalAlta = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!form.clienteId || !form.titulo.trim() || guardando">
                  {{ guardando ? 'Guardando…' : 'Cargar' }}
                </button>
              </footer>
            </form>
          </div>
        </div>
      </Teleport>

      <!-- Crear tarea -->
      <Teleport to="body">
        <div v-if="modalTarea" class="ds-modal-backdrop">
          <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-label="Crear tarea">
            <h2 class="text-base font-semibold text-ink mb-1">Crear tarea</h2>
            <p class="text-xs text-ink-soft mb-4">
              Se crea con el título, la descripción y una copia de los adjuntos de
              «{{ incidenciaParaTarea?.titulo }}». Desde ahí, el estado de la tarea marca el de la incidencia.
            </p>
            <form class="space-y-3" @submit.prevent="confirmarCrearTarea">
              <div>
                <label class="ds-label" for="t-espacio">Espacio</label>
                <select id="t-espacio" v-model.number="destino.espacioId" class="ds-input" @change="cargarListas">
                  <option v-for="e in espacios" :key="e.id" :value="e.id">{{ e.nombre }}</option>
                </select>
              </div>
              <div>
                <label class="ds-label" for="t-lista">Lista</label>
                <select id="t-lista" v-model.number="destino.listaId" class="ds-input">
                  <option v-if="!listas.length" :value="0" disabled>Este espacio no tiene listas</option>
                  <option v-for="l in listas" :key="l.id" :value="l.id">{{ l.nombre }}</option>
                </select>
              </div>
              <div>
                <label class="ds-label" for="t-venc">Fecha estimada de resolución</label>
                <input id="t-venc" v-model="destino.fechaVencimiento" type="date" class="ds-input" />
                <p class="ds-hint">
                  Es el vencimiento de la tarea y lo que ve el cliente en su portal. Se puede
                  cargar después desde la tarea: el cambio le llega igual.
                </p>
              </div>
              <p v-if="tareaError" class="ds-error" role="alert">{{ tareaError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalTarea = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!destino.listaId || creandoTarea">
                  {{ creandoTarea ? 'Creando…' : 'Crear tarea' }}
                </button>
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
</style>
