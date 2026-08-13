<script setup lang="ts">
/**
 * Documento: ver / crear / editar. Título + cuerpo enriquecido (mismo editor que las
 * descripciones de tareas) + adjuntos + historial de versiones.
 *
 * El cuerpo se renderiza con v-html porque el servidor lo SANEA al guardar y al servir
 * (lista blanca compartida); las imágenes embebidas se sirven con auth, así que se
 * resuelven a blobs con `useArchivosProtegidos`.
 */
import { ref, watch, computed, nextTick } from 'vue'
import { IonIcon } from '@ionic/vue'
import {
  closeOutline, createOutline, trashOutline, attachOutline, timeOutline,
  documentTextOutline, downloadOutline, arrowUndoOutline,
} from 'ionicons/icons'
import DescripcionEditor from '@/components/tareas/DescripcionEditor.vue'
import { useDocumentacionStore, type Documento, type DocumentoVersion } from '@/stores/documentacion'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { resolverArchivo } from '@/composables/useArchivosProtegidos'
import { fechaHora } from '@/composables/useFormato'

const props = defineProps<{
  /** Documento a mostrar; null = alta. */
  documentoId: number | null
  docEspacioId: number
  docListaId: number
  /** Permiso de edición sobre el espacio (capa 2). */
  puedeEditar: boolean
}>()
const emit = defineEmits<{ (e: 'cerrar'): void; (e: 'guardado'): void }>()

const store = useDocumentacionStore()
const meStore = useMeStore()
const toast = useToast()

const abierto = ref(true)
useEscapeToClose(abierto, () => emit('cerrar'))

const doc = ref<Documento | null>(null)
const cargando = ref(false)
const guardando = ref(false)
const modoEdicion = ref(false)
const form = ref({ titulo: '', contenido: '' })

const versiones = ref<DocumentoVersion[]>([])
const verVersiones = ref(false)
const cuerpoHtml = ref('')

/** ¿Se puede escribir? Capability + permiso del espacio. */
const puedeEscribir = computed(() =>
  props.puedeEditar && meStore.can(props.documentoId ? 'documentacion:update' : 'documentacion:create'),
)

/**
 * Reemplaza los src de las imágenes protegidas por object URLs (se sirven con auth).
 * @param html - Cuerpo saneado que viene del backend.
 * @returns HTML listo para pintar.
 */
async function resolverImagenes(html: string): Promise<string> {
  if (!html) return ''
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1])
  let salida = html
  for (const src of srcs) {
    const url = await resolverArchivo(src)
    if (url !== src) salida = salida.split(`src="${src}"`).join(`src="${url}"`)
  }
  return salida
}

async function cargar(): Promise<void> {
  if (!props.documentoId) {
    // Alta: arranca directamente en edición.
    doc.value = null
    form.value = { titulo: '', contenido: '' }
    modoEdicion.value = true
    return
  }
  cargando.value = true
  doc.value = await store.fetchDocumento(props.documentoId)
  cargando.value = false
  if (doc.value) {
    form.value = { titulo: doc.value.titulo, contenido: doc.value.contenido ?? '' }
    cuerpoHtml.value = await resolverImagenes(doc.value.contenido ?? '')
  }
}

watch(() => props.documentoId, () => { void cargar() }, { immediate: true })

async function guardar(): Promise<void> {
  if (!form.value.titulo.trim()) { toast.error('El título es obligatorio'); return }
  guardando.value = true
  const r = await store.saveDocumento(
    {
      docEspacioId: props.docEspacioId,
      docListaId: props.docListaId,
      titulo: form.value.titulo,
      contenido: form.value.contenido || null,
    },
    props.documentoId ?? undefined,
  )
  guardando.value = false
  if (!r.ok) { toast.error(r.message); return }

  toast.success(props.documentoId ? 'Documento actualizado' : 'Documento creado')
  emit('guardado')
  if (!props.documentoId) { emit('cerrar'); return }

  modoEdicion.value = false
  await cargar()
}

async function eliminar(): Promise<void> {
  if (!props.documentoId || !confirm('¿Eliminar este documento?')) return
  const r = await store.removeDocumento(props.documentoId)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Documento eliminado')
  emit('guardado')
  emit('cerrar')
}

// ── Adjuntos ──

async function adjuntar(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !props.documentoId) return
  const r = await store.subirArchivo(file, props.documentoId)
  input.value = ''
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Archivo adjuntado')
  await cargar()
}

async function quitarAdjunto(id: number): Promise<void> {
  if (!confirm('¿Quitar este archivo?')) return
  const r = await store.eliminarArchivo(id)
  if (!r.ok) { toast.error(r.message); return }
  await cargar()
}

/** Descarga un adjunto (se sirve con auth → se resuelve a blob y se dispara el click). */
async function descargar(url: string, nombre: string): Promise<void> {
  const blobUrl = await resolverArchivo(url)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = nombre
  a.click()
}

/** Imagen del editor: la sube al storage de documentación (no al de tareas). */
async function subirImagenEditor(file: File): Promise<{ ok: boolean; message: string; url?: string }> {
  const r = await store.subirArchivo(file, props.documentoId ?? undefined)
  return { ok: r.ok, message: r.message, url: r.archivo?.url }
}

// ── Versiones ──

async function alternarVersiones(): Promise<void> {
  verVersiones.value = !verVersiones.value
  if (verVersiones.value && props.documentoId) {
    versiones.value = await store.fetchVersiones(props.documentoId)
  }
}

async function restaurar(v: DocumentoVersion): Promise<void> {
  if (!props.documentoId) return
  if (!confirm(`¿Restaurar la versión del ${fechaHora(v.createdAt)}?\n\nLa versión actual queda guardada en el historial.`)) return
  const r = await store.restaurarVersion(props.documentoId, v.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Versión restaurada')
  verVersiones.value = false
  emit('guardado')
  await cargar()
}

/** Tamaño legible de un adjunto. */
const tam = (bytes: number): string => (bytes > 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`)

function editar(): void {
  modoEdicion.value = true
  void nextTick()
}
</script>

<template>
  <Teleport defer to="ion-app">
    <div class="ds-modal-backdrop" @click.self="emit('cerrar')">
      <div class="ds-modal ds-modal-lg" role="dialog" aria-modal="true" aria-label="Documento">

        <!-- Encabezado -->
        <header class="flex items-start gap-3 mb-3">
          <div class="min-w-0 flex-1">
            <input
              v-if="modoEdicion"
              v-model="form.titulo"
              class="ds-input text-base font-semibold"
              placeholder="Título del documento"
              maxlength="200"
              autofocus
            />
            <template v-else>
              <h2 class="text-base font-semibold text-ink">{{ doc?.titulo }}</h2>
              <p v-if="doc" class="text-2xs text-ink-faint mt-0.5">
                {{ doc.lista?.nombre }} · creado por {{ doc.autor ?? '—' }}
                <span v-if="doc.editor"> · última edición de {{ doc.editor }} el {{ fechaHora(doc.updatedAt) }}</span>
              </p>
            </template>
          </div>
          <button class="row-action shrink-0" aria-label="Cerrar" @click="emit('cerrar')">
            <IonIcon :icon="closeOutline" class="text-[16px]" />
          </button>
        </header>

        <div v-if="cargando" class="space-y-2">
          <div class="ds-skeleton h-6 w-1/3"></div>
          <div class="ds-skeleton h-40"></div>
        </div>

        <template v-else>
          <!-- Cuerpo -->
          <div v-if="modoEdicion">
            <label class="ds-label">Contenido</label>
            <DescripcionEditor v-model="form.contenido" :subir="subirImagenEditor" />
            <p class="ds-hint mt-1">
              Podés escribir el documento acá, adjuntar archivos, o las dos cosas.
            </p>
          </div>

          <div v-else>
            <div v-if="cuerpoHtml" class="doc-cuerpo text-sm text-ink" v-html="cuerpoHtml"></div>
            <p v-else class="text-xs text-ink-faint py-6 text-center">
              Este documento no tiene texto: mirá los archivos adjuntos.
            </p>
          </div>

          <!-- Adjuntos -->
          <section v-if="documentoId" class="mt-4 border-t border-line-soft pt-3">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-xs font-semibold text-ink flex items-center gap-1.5">
                <IonIcon :icon="attachOutline" class="text-[14px] text-ink-faint" />
                Archivos ({{ doc?.archivos.length ?? 0 }})
              </h3>
              <label v-if="puedeEscribir" class="ds-btn-secondary h-7 px-2.5 text-xs cursor-pointer">
                Adjuntar
                <input type="file" class="hidden" @change="adjuntar" />
              </label>
            </div>

            <div v-if="doc?.archivos.length" class="border border-line rounded-lg divide-y divide-line-soft">
              <div v-for="a in doc.archivos" :key="a.id" class="flex items-center gap-2 px-3 h-10 text-xs">
                <IonIcon :icon="documentTextOutline" class="text-[14px] text-ink-faint shrink-0" />
                <span class="flex-1 truncate text-ink">{{ a.nombreOriginal }}</span>
                <span class="text-ink-faint tnum shrink-0">{{ tam(a.size) }}</span>
                <button class="row-action" title="Descargar" aria-label="Descargar" @click="descargar(a.url, a.nombreOriginal)">
                  <IonIcon :icon="downloadOutline" class="text-[14px]" />
                </button>
                <button v-if="puedeEscribir" class="row-action" title="Quitar" aria-label="Quitar" @click="quitarAdjunto(a.id)">
                  <IonIcon :icon="trashOutline" class="text-[14px]" />
                </button>
              </div>
            </div>
            <p v-else class="text-2xs text-ink-faint">Sin archivos adjuntos.</p>
          </section>

          <!-- Historial de versiones -->
          <section v-if="documentoId" class="mt-3">
            <button class="text-xs text-ink-soft hover:text-ink flex items-center gap-1.5" @click="alternarVersiones()">
              <IonIcon :icon="timeOutline" class="text-[14px]" />
              {{ verVersiones ? 'Ocultar' : 'Ver' }} historial de versiones
            </button>

            <div v-if="verVersiones" class="mt-2">
              <div v-if="versiones.length" class="border border-line rounded-lg divide-y divide-line-soft max-h-56 overflow-y-auto">
                <div v-for="v in versiones" :key="v.id" class="flex items-center gap-2 px-3 py-2 text-xs">
                  <div class="min-w-0 flex-1">
                    <p class="text-ink truncate">{{ v.titulo }}</p>
                    <p class="text-2xs text-ink-faint">{{ fechaHora(v.createdAt) }} · {{ v.usuario ?? '—' }}</p>
                  </div>
                  <button v-if="puedeEscribir" class="ds-btn-secondary h-7 px-2 text-2xs flex items-center gap-1" @click="restaurar(v)">
                    <IonIcon :icon="arrowUndoOutline" class="text-[12px]" /> Restaurar
                  </button>
                </div>
              </div>
              <p v-else class="text-2xs text-ink-faint py-2">Todavía no hay ediciones registradas.</p>
            </div>
          </section>
        </template>

        <!-- Pie -->
        <footer class="flex justify-between items-center gap-2 pt-4 mt-2 border-t border-line-soft">
          <button
            v-if="documentoId && puedeEditar && meStore.can('documentacion:delete')"
            class="ds-btn-danger h-8 px-3 text-xs"
            @click="eliminar()"
          >
            Eliminar
          </button>
          <div class="flex gap-2 ml-auto">
            <template v-if="modoEdicion">
              <button v-if="documentoId" type="button" class="ds-btn-secondary" @click="modoEdicion = false">Cancelar</button>
              <button type="button" class="ds-btn-primary" :disabled="guardando" @click="guardar()">
                {{ guardando ? 'Guardando…' : 'Guardar' }}
              </button>
            </template>
            <template v-else>
              <button type="button" class="ds-btn-secondary" @click="emit('cerrar')">Cerrar</button>
              <button v-if="puedeEscribir" type="button" class="ds-btn-primary flex items-center gap-1.5" @click="editar()">
                <IonIcon :icon="createOutline" class="text-[15px]" /> Editar
              </button>
            </template>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.row-action {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }

/* Cuerpo del documento: tipografía de lectura para el HTML saneado. */
.doc-cuerpo :deep(p) { margin: 0 0 0.6em; line-height: 1.6; }
.doc-cuerpo :deep(h1), .doc-cuerpo :deep(h2), .doc-cuerpo :deep(h3), .doc-cuerpo :deep(h4) {
  font-weight: 600; margin: 1em 0 0.4em; line-height: 1.3;
}
.doc-cuerpo :deep(h1) { font-size: 1.25rem; }
.doc-cuerpo :deep(h2) { font-size: 1.1rem; }
.doc-cuerpo :deep(h3) { font-size: 1rem; }
.doc-cuerpo :deep(ul), .doc-cuerpo :deep(ol) { padding-left: 1.3em; margin: 0 0 0.6em; }
.doc-cuerpo :deep(ul) { list-style: disc; }
.doc-cuerpo :deep(ol) { list-style: decimal; }
.doc-cuerpo :deep(ul[data-type='taskList']) { list-style: none; padding-left: 0.2em; }
.doc-cuerpo :deep(blockquote) {
  border-left: 3px solid rgb(var(--s-line)); padding-left: 0.8em; color: rgb(var(--s-ink-soft)); margin: 0 0 0.6em;
}
.doc-cuerpo :deep(pre) {
  background: rgb(var(--s-surface-2)); padding: 0.7em; border-radius: 8px; overflow-x: auto; font-size: 0.85em;
}
.doc-cuerpo :deep(code) { font-family: ui-monospace, monospace; font-size: 0.9em; }
.doc-cuerpo :deep(a) { color: rgb(var(--s-accent)); text-decoration: underline; text-underline-offset: 2px; }
.doc-cuerpo :deep(img) { max-width: 100%; border-radius: 8px; margin: 0.4em 0; }
.doc-cuerpo :deep(table) { width: 100%; border-collapse: collapse; margin: 0 0 0.8em; font-size: 0.9em; }
.doc-cuerpo :deep(th), .doc-cuerpo :deep(td) { border: 1px solid rgb(var(--s-line)); padding: 0.35em 0.5em; text-align: left; }
.doc-cuerpo :deep(th) { background: rgb(var(--s-surface-2)); font-weight: 600; }
.doc-cuerpo :deep(hr) { border: 0; border-top: 1px solid rgb(var(--s-line)); margin: 1em 0; }
</style>
