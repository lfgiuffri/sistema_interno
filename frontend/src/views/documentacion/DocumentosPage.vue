<script setup lang="ts">
/**
 * Documentos de una lista: tarjetas con título, extracto y adjuntos, reordenables por
 * drag & drop. Abrir uno muestra el modal de lectura/edición (query `?doc=<id>`, para que
 * el link sea compartible — mismo criterio que los filtros de tareas).
 */
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  addOutline, arrowBackOutline, documentTextOutline, attachOutline,
  reorderTwoOutline, swapHorizontalOutline,
} from 'ionicons/icons'
import DocumentoModal from '@/components/documentacion/DocumentoModal.vue'
import { useDocumentacionStore, type DocumentoListado } from '@/stores/documentacion'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fecha as fmtFecha } from '@/composables/useFormato'

const store = useDocumentacionStore()
const meStore = useMeStore()
const toast = useToast()
const route = useRoute()
const router = useRouter()

const espacioId = Number(route.params.deid)
const listaId = Number(route.params.dlid)

// Documento abierto: null = cerrado, 0 = alta, >0 = ver/editar ese id.
const abierto = ref<number | null>(null)

const modalMover = ref(false)
const moviendo = ref<DocumentoListado | null>(null)
const destinoLista = ref<number | null>(null)
useEscapeToClose(modalMover, () => { modalMover.value = false })

/** ¿Puede escribir? Capability + permiso de edición sobre el espacio (capa 2). */
const puedeEscribir = (): boolean => meStore.can('documentacion:update') && store.puedeEditar

function abrir(id: number | null): void {
  abierto.value = id
  // El id viaja en la query para poder compartir el link directo al documento.
  const query = id ? { ...route.query, doc: String(id) } : { ...route.query, doc: undefined }
  void router.replace({ query })
}

async function recargar(): Promise<void> {
  await store.fetchDocumentos(espacioId, listaId)
}

// ── Mover a otra lista ──

async function abrirMover(d: DocumentoListado): Promise<void> {
  moviendo.value = d
  destinoLista.value = null
  // Las listas del espacio hacen de destinos posibles.
  if (!store.listas.length) await store.fetchListas(espacioId)
  modalMover.value = true
}

async function confirmarMover(): Promise<void> {
  if (!moviendo.value || !destinoLista.value) return
  const r = await store.moverDocumento(moviendo.value.id, espacioId, destinoLista.value)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Documento movido')
  modalMover.value = false
  await recargar()
}

// ── Drag & drop de documentos ──
const arrastrando = ref<number | null>(null)

function onDragStart(d: DocumentoListado): void {
  if (!puedeEscribir()) return
  arrastrando.value = d.id
}

/**
 * Reordena en memoria mientras se arrastra; persiste al soltar.
 * @param destino - Documento sobre el que se está pasando.
 */
function onDragOver(destino: DocumentoListado): void {
  if (arrastrando.value === null || arrastrando.value === destino.id) return
  const actual = [...store.documentos]
  const desde = actual.findIndex(d => d.id === arrastrando.value)
  const hasta = actual.findIndex(d => d.id === destino.id)
  if (desde < 0 || hasta < 0) return
  const [movido] = actual.splice(desde, 1)
  actual.splice(hasta, 0, movido)
  store.documentos = actual
}

async function onDrop(): Promise<void> {
  if (arrastrando.value === null) return
  arrastrando.value = null
  const r = await store.ordenarDocumentos(espacioId, listaId, store.documentos.map(d => d.id))
  if (!r.ok) { toast.error(r.message); await recargar() }
}

let loadedOnce = false
onMounted(async () => {
  loadedOnce = true
  await recargar()
  // Link directo a un documento (?doc=<id>).
  const doc = Number(route.query.doc)
  if (doc > 0) abierto.value = doc
})
onIonViewWillEnter(() => { if (loadedOnce) void recargar() })
watch(() => route.query.doc, (v) => { if (!v) abierto.value = null })
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

        <button
          class="flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink transition-colors mb-3"
          @click="router.push(`/documentacion/espacios/${espacioId}`)"
        >
          <IonIcon :icon="arrowBackOutline" class="text-[14px]" />
          {{ store.espacioActual?.nombre ?? 'Espacio' }}
        </button>

        <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">{{ store.listaActual?.nombre ?? 'Lista' }}</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              {{ store.listaActual?.descripcion || `${store.documentos.length} documento(s) en esta lista.` }}
            </p>
          </div>
          <button v-if="meStore.can('documentacion:create') && store.puedeEditar" class="ds-btn-primary flex items-center gap-1.5" @click="abrir(0)">
            <IonIcon :icon="addOutline" class="text-[16px]" /> Nuevo documento
          </button>
        </header>

        <div v-if="store.loading && !store.documentos.length" class="space-y-2">
          <div v-for="i in 3" :key="i" class="ds-skeleton h-20"></div>
        </div>

        <div v-else-if="store.documentos.length" class="space-y-2">
          <div
            v-for="d in store.documentos"
            :key="d.id"
            class="ds-card px-4 py-3 flex items-start gap-3 transition-colors"
            :class="arrastrando === d.id ? 'ring-1 ring-accent' : ''"
            :draggable="puedeEscribir()"
            @dragstart="onDragStart(d)"
            @dragover.prevent="onDragOver(d)"
            @drop.prevent="onDrop()"
            @dragend="onDrop()"
          >
            <IonIcon
              v-if="puedeEscribir()"
              :icon="reorderTwoOutline"
              class="text-[16px] text-ink-faint shrink-0 cursor-grab mt-0.5"
              title="Arrastrar para reordenar"
            />
            <button class="flex-1 min-w-0 text-left group" @click="abrir(d.id)">
              <div class="flex items-center gap-2">
                <IonIcon :icon="documentTextOutline" class="text-[15px] text-ink-faint shrink-0" />
                <span class="text-sm font-medium text-ink group-hover:text-accent transition-colors truncate">{{ d.titulo }}</span>
                <span v-if="d.archivosCount" class="ds-badge-neutral shrink-0">
                  <IonIcon :icon="attachOutline" class="text-[11px]" /> {{ d.archivosCount }}
                </span>
              </div>
              <p v-if="d.extracto" class="mt-1 text-xs text-ink-soft line-clamp-2">{{ d.extracto }}</p>
              <p v-else-if="d.archivosCount" class="mt-1 text-xs text-ink-faint italic">Solo archivos adjuntos</p>
              <p class="mt-1 text-2xs text-ink-faint">
                {{ d.editor ?? d.autor ?? '—' }} · actualizado {{ fmtFecha(d.updatedAt) }}
              </p>
            </button>

            <button
              v-if="puedeEscribir()"
              class="row-action shrink-0"
              title="Mover a otra lista"
              aria-label="Mover a otra lista"
              @click="abrirMover(d)"
            >
              <IonIcon :icon="swapHorizontalOutline" class="text-[15px]" />
            </button>
          </div>
        </div>

        <div v-else class="ds-card px-6 py-12 text-center">
          <p class="text-sm font-medium text-ink">Esta lista todavía no tiene documentos.</p>
          <p class="text-xs text-ink-faint mt-1">Un documento puede ser un texto escrito acá, un archivo adjunto, o las dos cosas.</p>
          <button
            v-if="meStore.can('documentacion:create') && store.puedeEditar"
            class="ds-btn-primary mt-4"
            @click="abrir(0)"
          >
            Crear el primero
          </button>
        </div>
      </div>

      <!-- Ver / editar documento -->
      <DocumentoModal
        v-if="abierto !== null"
        :documento-id="abierto || null"
        :doc-espacio-id="espacioId"
        :doc-lista-id="listaId"
        :puede-editar="store.puedeEditar"
        @cerrar="abrir(null)"
        @guardado="recargar()"
      />

      <!-- Mover a otra lista -->
      <Teleport defer to="ion-app">
        <div v-if="modalMover" class="ds-modal-backdrop" @click.self="modalMover = false">
          <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-label="Mover documento">
            <h2 class="text-base font-semibold text-ink mb-1">Mover documento</h2>
            <p class="text-xs text-ink-soft mb-3">«{{ moviendo?.titulo }}» pasa a la lista que elijas.</p>
            <label class="ds-label" for="mover-destino">Lista destino</label>
            <select id="mover-destino" v-model.number="destinoLista" class="ds-input mb-4">
              <option :value="null" disabled>Elegí una lista…</option>
              <option v-for="l in store.listas.filter(x => x.id !== listaId)" :key="l.id" :value="l.id">{{ l.nombre }}</option>
            </select>
            <footer class="flex justify-end gap-2">
              <button type="button" class="ds-btn-secondary" @click="modalMover = false">Cancelar</button>
              <button type="button" class="ds-btn-primary" :disabled="!destinoLista" @click="confirmarMover()">Mover</button>
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
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
