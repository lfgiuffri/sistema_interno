<script setup lang="ts">
/**
 * Listas de un espacio: tabla con agregados (pendientes/vencidas/próximo vencimiento),
 * buscador en caliente, alta/edición en modal y reactivación de eliminadas (409).
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  chevronBackOutline, addOutline, searchOutline, createOutline, trashOutline,
  powerOutline, listOutline, copyOutline,
} from 'ionicons/icons'
import { useTareasStore, type ListaRow } from '@/stores/tareas'
import ThOrdenable from '@/components/shared/ThOrdenable.vue'
import { useOrdenTabla } from '@/composables/useOrdenTabla'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fecha as fmtFecha } from '@/composables/useFormato'

const route = useRoute()
const router = useRouter()
const tareasStore = useTareasStore()
const toast = useToast()

const espacioId = computed(() => Number(route.params.eid) || 0)
const espacio = ref<{ id: number; nombre: string; activo: boolean } | null>(null)
const puedeEditar = ref(false)
/** Lista que se está clonando (para deshabilitar el botón: puede tardar con muchas tareas). */
const clonando = ref<number | null>(null)
const listas = ref<ListaRow[]>([])
const loading = ref(false)
const busqueda = ref('')

const modal = ref(false)
const editando = ref<ListaRow | null>(null)
const form = ref({ nombre: '', descripcion: '' })
const formError = ref('')
useEscapeToClose(modal, () => { modal.value = false })

/** Filtro en caliente normalizando acentos (como el buscador del legado). */
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const filtradas = computed(() => {
  if (!busqueda.value.trim()) return listas.value
  const q = normalizar(busqueda.value)
  return listas.value.filter(l => normalizar(l.nombre).includes(q))
})

// Se ordena lo ya filtrado por el buscador.
const orden = useOrdenTabla(() => filtradas.value)

async function load(): Promise<void> {
  loading.value = true
  const data = await tareasStore.fetchListas(espacioId.value).catch(() => null)
  loading.value = false
  if (!data) { toast.error('Espacio de trabajo no encontrado'); router.replace('/tareas'); return }
  espacio.value = data.espacio
  puedeEditar.value = data.puedeEditar
  listas.value = data.listas
}

function abrirModal(lista?: ListaRow): void {
  editando.value = lista ?? null
  form.value = { nombre: lista?.nombre ?? '', descripcion: lista?.descripcion ?? '' }
  formError.value = ''
  modal.value = true
}

async function guardar(): Promise<void> {
  if (!form.value.nombre.trim()) return
  const r = await tareasStore.saveLista(espacioId.value, {
    nombre: form.value.nombre.trim(),
    descripcion: form.value.descripcion.trim() || undefined,
  }, editando.value?.id)

  if (!r.ok) {
    // Eliminada homónima: ofrecer reactivarla (mismo patrón que los catálogos).
    if (r.errorCode === 'EXISTE_ELIMINADO' && r.deletedId) {
      modal.value = false
      const alert = await alertController.create({
        header: 'Lista eliminada encontrada',
        message: r.message,
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          {
            text: 'Reactivar',
            handler: async () => {
              const rr = await tareasStore.restoreLista(espacioId.value, r.deletedId as number)
              if (!rr.ok) { toast.error(rr.message); return }
              toast.success('Lista reactivada')
              await load()
            },
          },
        ],
      })
      await alert.present()
      return
    }
    formError.value = r.message
    return
  }
  toast.success(editando.value ? 'Lista actualizada' : 'Lista creada')
  modal.value = false
  await load()
}

async function toggle(lista: ListaRow): Promise<void> {
  const r = await tareasStore.toggleLista(espacioId.value, lista.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Estado de la lista cambiado')
  await load()
}

/**
 * Clona una lista con todas sus tareas. Se pide confirmación porque con muchas tareas es una
 * operación grande (cada adjunto se copia también) y el botón está al lado de «desactivar».
 */
async function clonar(lista: ListaRow): Promise<void> {
  const alert = await alertController.create({
    header: 'Clonar la lista',
    message: `Se va a crear una copia de «${lista.nombre}» con todas sus tareas. Las tareas copiadas arrancan abiertas.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Solo la lista', role: 'sola' },
      { text: 'Clonar con tareas', role: 'confirm' },
    ],
  })
  await alert.present()
  const { role } = await alert.onDidDismiss()
  if (role !== 'confirm' && role !== 'sola') return

  clonando.value = lista.id
  const r = await tareasStore.clonarLista(espacioId.value, lista.id, role === 'confirm')
  clonando.value = null
  if (!r.ok) { toast.error(r.message); return }

  const d = r.data as { lista: { nombre: string }; tareas: number; errores: unknown[] } | undefined
  toast.success(d?.tareas
    ? `«${d.lista.nombre}» creada con ${d.tareas} tarea(s)`
    : `«${d?.lista.nombre}» creada`)
  // Si alguna tarea no se pudo clonar se avisa: quedarse callado haría creer que está completa.
  if (d?.errores?.length) toast.error(`${d.errores.length} tarea(s) no se pudieron clonar`)
  await load()
}

async function confirmDelete(lista: ListaRow): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar lista',
    message: `¿Eliminar la lista «${lista.nombre}»? Si tiene tareas no se puede eliminar.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await tareasStore.removeLista(espacioId.value, lista.id)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Lista eliminada')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void load() })
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

        <button class="ds-btn-ghost h-8 -ml-2 mb-3" @click="router.push('/tareas')">
          <IonIcon :icon="chevronBackOutline" class="text-[14px]" />
          Tareas
        </button>

        <header class="flex items-center justify-between gap-4 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">
              {{ espacio?.nombre ?? '…' }}
              <span v-if="espacio && !espacio.activo" class="ds-badge-neutral align-middle ml-1">Inactivo</span>
            </h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              Listas del espacio{{ puedeEditar ? '' : ' · solo lectura' }}.
            </p>
          </div>
          <button v-if="puedeEditar" class="ds-btn-primary" @click="abrirModal()">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nueva lista
          </button>
        </header>

        <div class="relative w-56 mb-4">
          <IonIcon :icon="searchOutline" class="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint pointer-events-none" />
          <input v-model="busqueda" class="ds-input h-9 pl-9" type="search" placeholder="Filtrar listas…" />
        </div>

        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <ThOrdenable columna="nombre" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Lista</ThOrdenable>
                <ThOrdenable columna="pendientes" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Pendientes</ThOrdenable>
                <ThOrdenable columna="vencidas" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Vencidas</ThOrdenable>
                <ThOrdenable columna="proximoVencimiento" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Próximo vencimiento</ThOrdenable>
                <ThOrdenable columna="activa" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Estado</ThOrdenable>
                <th class="w-24"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="loading && !listas.length">
              <tr v-for="i in 4" :key="i"><td colspan="6" class="!px-3"><div class="ds-skeleton h-5 w-full my-2"></div></td></tr>
            </tbody>

            <tbody v-else-if="filtradas.length">
              <tr v-for="l in orden.ordenadas.value" :key="l.id" :class="{ 'opacity-50': !l.activa }">
                <td>
                  <button class="text-left group" @click="router.push(`/tareas/espacios/${espacioId}/listas/${l.id}`)">
                    <p class="font-medium text-ink group-hover:text-accent transition-colors">{{ l.nombre }}</p>
                    <p v-if="l.descripcion" class="text-2xs text-ink-faint">{{ l.descripcion }}</p>
                  </button>
                </td>
                <td class="tnum text-ink">{{ l.pendientes }}</td>
                <td>
                  <span v-if="l.vencidas" class="ds-badge-danger tnum">{{ l.vencidas }}</span>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td>
                  <span v-if="l.proximoVencimiento" class="tnum text-ink-soft">
                    {{ fmtFecha(l.proximoVencimiento) }}
                    <span v-if="l.proximoVencimiento < new Date().toISOString().slice(0, 10)" class="ds-badge-danger ml-1">vencido</span>
                  </span>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td>
                  <span :class="l.activa ? 'ds-badge-ok' : 'ds-badge-neutral'">{{ l.activa ? 'Activa' : 'Inactiva' }}</span>
                </td>
                <td>
                  <div v-if="puedeEditar" class="flex items-center justify-end gap-0.5">
                    <button class="row-action" title="Editar" aria-label="Editar" @click="abrirModal(l)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button
                      class="row-action" :disabled="clonando === l.id"
                      title="Clonar la lista con todas sus tareas" aria-label="Clonar la lista"
                      @click="clonar(l)"
                    >
                      <IonIcon :icon="copyOutline" class="text-[15px]" :class="{ 'animate-pulse': clonando === l.id }" />
                    </button>
                    <button class="row-action" :title="l.activa ? 'Desactivar' : 'Activar'" aria-label="Activar o desactivar" @click="toggle(l)">
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="confirmDelete(l)">
                      <IonIcon :icon="trashOutline" class="text-[15px]" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>

            <tbody v-else>
              <tr>
                <td colspan="6" class="!h-auto">
                  <div class="flex flex-col items-center py-12 text-center">
                    <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
                      <IonIcon :icon="listOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">{{ busqueda ? 'Sin resultados' : 'Este espacio no tiene listas todavía' }}</p>
                    <p v-if="!busqueda && puedeEditar" class="text-xs text-ink-faint mt-1">Creá la primera con «Nueva lista».</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="busqueda" class="text-2xs text-ink-faint mt-2 tnum">{{ filtradas.length }} de {{ listas.length }}</p>
      </div>

      <!-- Modal lista -->
      <Teleport defer to="ion-app">
        <div v-if="modal" class="ds-modal-backdrop" @click.self="modal = false">
          <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" :aria-label="editando ? 'Editar lista' : 'Nueva lista'">
            <h2 class="text-base font-semibold text-ink mb-3">{{ editando ? 'Editar lista' : 'Nueva lista' }}</h2>
            <form class="space-y-3" @submit.prevent="guardar">
              <div>
                <label class="ds-label" for="ls-nombre">Nombre</label>
                <input id="ls-nombre" v-model="form.nombre" class="ds-input" type="text" required maxlength="100" />
              </div>
              <div>
                <label class="ds-label" for="ls-desc">Descripción</label>
                <input id="ls-desc" v-model="form.descripcion" class="ds-input" type="text" maxlength="255" />
              </div>
              <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modal = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!form.nombre.trim()">
                  {{ editando ? 'Guardar' : 'Crear lista' }}
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
