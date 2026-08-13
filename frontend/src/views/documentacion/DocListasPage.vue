<script setup lang="ts">
/**
 * Listas de un espacio de documentación: ABM + reordenamiento por drag & drop.
 * Cada lista tiene título, descripción opcional y su conteo de documentos.
 * Las acciones de escritura se gatean por capability Y por `puedeEditar` del espacio.
 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  addOutline, arrowBackOutline, createOutline, trashOutline, eyeOffOutline,
  eyeOutline, folderOpenOutline, reorderTwoOutline,
} from 'ionicons/icons'
import { useDocumentacionStore, type DocLista } from '@/stores/documentacion'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'

const store = useDocumentacionStore()
const meStore = useMeStore()
const toast = useToast()
const route = useRoute()
const router = useRouter()

const espacioId = Number(route.params.deid)

const modal = ref(false)
const editando = ref<DocLista | null>(null)
const form = ref({ nombre: '', descripcion: '' })
const guardando = ref(false)
useEscapeToClose(modal, () => { modal.value = false })

/** ¿Puede escribir? Capability + permiso de edición sobre este espacio (capa 2). */
const puedeEscribir = (): boolean => meStore.can('documentacion:update') && store.puedeEditar

function abrirNueva(): void {
  editando.value = null
  form.value = { nombre: '', descripcion: '' }
  modal.value = true
}

function abrirEditar(l: DocLista): void {
  editando.value = l
  form.value = { nombre: l.nombre, descripcion: l.descripcion ?? '' }
  modal.value = true
}

async function guardar(): Promise<void> {
  if (!form.value.nombre.trim()) return
  guardando.value = true
  const r = await store.saveLista(espacioId, { ...form.value }, editando.value?.id)
  guardando.value = false

  if (!r.ok) {
    // 409 EXISTE_ELIMINADO: hubo una lista con ese nombre, se ofrece reactivarla.
    if (r.errorCode === 'EXISTE_ELIMINADO' && r.deletedId && confirm(`${r.message}\n\n¿Reactivarla?`)) {
      const rr = await store.restoreLista(espacioId, r.deletedId)
      if (rr.ok) { toast.success('Lista reactivada'); modal.value = false; await store.fetchListas(espacioId) }
      else toast.error(rr.message)
      return
    }
    toast.error(r.message)
    return
  }

  toast.success(editando.value ? 'Lista actualizada' : 'Lista creada')
  modal.value = false
  await store.fetchListas(espacioId)
}

async function alternar(l: DocLista): Promise<void> {
  const r = await store.toggleLista(espacioId, l.id)
  if (!r.ok) { toast.error(r.message); return }
  await store.fetchListas(espacioId)
}

async function eliminar(l: DocLista): Promise<void> {
  if (!confirm(`¿Eliminar la lista «${l.nombre}»?`)) return
  const r = await store.removeLista(espacioId, l.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Lista eliminada')
  await store.fetchListas(espacioId)
}

// ── Drag & drop de listas ──
const arrastrando = ref<number | null>(null)

function onDragStart(l: DocLista): void {
  if (!puedeEscribir()) return
  arrastrando.value = l.id
}

/**
 * Reordena en memoria mientras se arrastra (feedback inmediato) y persiste al soltar.
 * @param destino - Lista sobre la que se está pasando.
 */
function onDragOver(destino: DocLista): void {
  if (arrastrando.value === null || arrastrando.value === destino.id) return
  const actual = [...store.listas]
  const desde = actual.findIndex(l => l.id === arrastrando.value)
  const hasta = actual.findIndex(l => l.id === destino.id)
  if (desde < 0 || hasta < 0) return
  const [movida] = actual.splice(desde, 1)
  actual.splice(hasta, 0, movida)
  store.listas = actual
}

async function onDrop(): Promise<void> {
  if (arrastrando.value === null) return
  arrastrando.value = null
  const r = await store.ordenarListas(espacioId, store.listas.map(l => l.id))
  if (!r.ok) { toast.error(r.message); await store.fetchListas(espacioId) }
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void store.fetchListas(espacioId) })
onIonViewWillEnter(() => { if (loadedOnce) void store.fetchListas(espacioId) })
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

        <button class="flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink transition-colors mb-3" @click="router.push('/documentacion')">
          <IonIcon :icon="arrowBackOutline" class="text-[14px]" /> Documentación
        </button>

        <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">{{ store.espacioActual?.nombre ?? 'Espacio' }}</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              {{ store.espacioActual?.descripcion || 'Listas de documentación de este espacio.' }}
            </p>
          </div>
          <button v-if="puedeEscribir()" class="ds-btn-primary flex items-center gap-1.5" @click="abrirNueva()">
            <IonIcon :icon="addOutline" class="text-[16px]" /> Nueva lista
          </button>
        </header>

        <div v-if="store.loading && !store.listas.length" class="space-y-2">
          <div v-for="i in 3" :key="i" class="ds-skeleton h-16"></div>
        </div>

        <div v-else-if="store.listas.length" class="space-y-2">
          <div
            v-for="l in store.listas"
            :key="l.id"
            class="ds-card px-4 py-3 flex items-center gap-3 transition-colors"
            :class="[{ 'opacity-60': !l.activa }, arrastrando === l.id ? 'ring-1 ring-accent' : '']"
            :draggable="puedeEscribir()"
            @dragstart="onDragStart(l)"
            @dragover.prevent="onDragOver(l)"
            @drop.prevent="onDrop()"
            @dragend="onDrop()"
          >
            <IonIcon
              v-if="puedeEscribir()"
              :icon="reorderTwoOutline"
              class="text-[16px] text-ink-faint shrink-0 cursor-grab"
              title="Arrastrar para reordenar"
            />
            <button class="flex-1 min-w-0 text-left group" @click="router.push(`/documentacion/espacios/${espacioId}/listas/${l.id}`)">
              <div class="flex items-center gap-2">
                <IonIcon :icon="folderOpenOutline" class="text-[15px] text-ink-faint" />
                <span class="text-sm font-medium text-ink group-hover:text-accent transition-colors">{{ l.nombre }}</span>
                <span class="ds-badge-neutral">{{ l.documentosCount }}</span>
                <span v-if="!l.activa" class="ds-badge-warn">inactiva</span>
              </div>
              <p v-if="l.descripcion" class="text-2xs text-ink-faint mt-0.5 truncate">{{ l.descripcion }}</p>
            </button>

            <div v-if="puedeEscribir()" class="flex items-center gap-1 shrink-0">
              <button class="row-action" title="Editar" aria-label="Editar lista" @click="abrirEditar(l)">
                <IonIcon :icon="createOutline" class="text-[15px]" />
              </button>
              <button class="row-action" :title="l.activa ? 'Desactivar' : 'Activar'" :aria-label="l.activa ? 'Desactivar' : 'Activar'" @click="alternar(l)">
                <IonIcon :icon="l.activa ? eyeOffOutline : eyeOutline" class="text-[15px]" />
              </button>
              <button v-if="meStore.can('documentacion:delete')" class="row-action" title="Eliminar" aria-label="Eliminar lista" @click="eliminar(l)">
                <IonIcon :icon="trashOutline" class="text-[15px]" />
              </button>
            </div>
          </div>
        </div>

        <div v-else class="ds-card px-6 py-12 text-center">
          <p class="text-sm font-medium text-ink">Este espacio todavía no tiene listas.</p>
          <p class="text-xs text-ink-faint mt-1">
            Una lista agrupa documentos por tema (ej. «Onboarding», «Infraestructura»).
          </p>
          <button v-if="puedeEscribir()" class="ds-btn-primary mt-4" @click="abrirNueva()">Crear la primera</button>
        </div>
      </div>

      <!-- Modal de lista -->
      <Teleport defer to="ion-app">
        <div v-if="modal" class="ds-modal-backdrop" @click.self="modal = false">
          <div class="ds-modal max-w-md" role="dialog" aria-modal="true" :aria-label="editando ? 'Editar lista' : 'Nueva lista'">
            <h2 class="text-base font-semibold text-ink mb-3">{{ editando ? 'Editar lista' : 'Nueva lista' }}</h2>
            <form @submit.prevent="guardar">
              <div class="mb-3">
                <label class="ds-label" for="lista-nombre">Título</label>
                <input id="lista-nombre" v-model="form.nombre" class="ds-input" maxlength="120" required autofocus />
              </div>
              <div class="mb-4">
                <label class="ds-label" for="lista-desc">Descripción (opcional)</label>
                <input id="lista-desc" v-model="form.descripcion" class="ds-input" maxlength="255" />
              </div>
              <footer class="flex justify-end gap-2">
                <button type="button" class="ds-btn-secondary" @click="modal = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
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
