<script setup lang="ts">
/**
 * Página genérica de catálogo (ABM en modal — patrón del legado para ABMs chicos).
 *
 * Parametrizada por config: endpoint, capability prefix, campos del formulario y columnas
 * de la tabla. Cubre el contrato completo de los catálogos del backend: búsqueda
 * server-side, paginación, alta/edición en modal, toggle, baja protegida (409 con motivo)
 * y el flujo de reactivación (409 EXISTE_ELIMINADO → alert "¿Reactivar?").
 *
 * Personalización de celdas vía slot: `#cell-<key>="{ row }"`.
 */
import { ref, computed, onMounted } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  addOutline, searchOutline, createOutline, trashOutline, powerOutline,
  closeOutline, fileTrayOutline,
} from 'ionicons/icons'
import { useCatalogo, type CatalogoRow } from '@/composables/useCatalogo'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'

/** Definición de un campo del formulario del modal. */
export interface CampoDef {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'number' | 'email' | 'select'
  required?: boolean
  hint?: string
  /** Para type 'select': opciones { value, label, disabled? }. */
  options?: Array<{ value: number | string; label: string }>
  /** Ocupa toda la fila del grid (default: media fila). */
  full?: boolean
}

/** Definición de una columna de la tabla. */
export interface ColumnaDef {
  key: string
  label: string
}

const props = defineProps<{
  titulo: string
  subtitulo: string
  /** Endpoint REST (ej. 'areas', 'sueldos/cuentas'). */
  endpoint: string
  /** Prefijo de capabilities si difiere del endpoint (ej. 'cuentas'). */
  capPrefix?: string
  /** Sustantivo con artículo para los textos (ej. 'el área', 'la forma de facturación'). */
  sustantivo: string
  campos: CampoDef[]
  columnas: ColumnaDef[]
}>()

const emit = defineEmits<{ (e: 'loaded'): void }>()

const catalogo = useCatalogo(props.endpoint)
const meStore = useMeStore()
const toast = useToast()

const search = ref('')
const page = ref(1)
let searchTimer: ReturnType<typeof setTimeout> | null = null

const modalOpen = ref(false)
useEscapeToClose(modalOpen, () => { modalOpen.value = false })
const editing = ref<CatalogoRow | null>(null)
const form = ref<Record<string, unknown>>({})
const formError = ref('')

const isEdit = computed(() => editing.value !== null)
const canSave = computed(() =>
  props.campos.every(c => !c.required || String(form.value[c.key] ?? '').trim() !== '')
)

const cap = (accion: string) => `${props.capPrefix ?? props.endpoint}:${accion}`

async function load(): Promise<void> {
  await catalogo.fetchList({ page: page.value, search: search.value })
  emit('loaded')
}

function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; void load() }, 250)
}

/** Form vacío según la config de campos. */
function emptyForm(): Record<string, unknown> {
  return Object.fromEntries(props.campos.map(c => [c.key, c.type === 'select' ? 0 : '']))
}

function openCreate(): void {
  editing.value = null
  form.value = emptyForm()
  formError.value = ''
  modalOpen.value = true
}

function openEdit(row: CatalogoRow): void {
  editing.value = row
  form.value = Object.fromEntries(props.campos.map(c => [c.key, row[c.key] ?? (c.type === 'select' ? 0 : '')]))
  formError.value = ''
  modalOpen.value = true
}

/** Normaliza el form al payload (números para selects/numbers, trims). */
function buildPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const campo of props.campos) {
    const raw = form.value[campo.key]
    if (campo.type === 'select' || campo.type === 'number') {
      payload[campo.key] = Number(raw) || 0
    } else {
      const trimmed = String(raw ?? '').trim()
      // Los opcionales vacíos no viajan (el backend los guarda como estaban / null).
      if (trimmed === '' && !campo.required) continue
      payload[campo.key] = trimmed
    }
  }
  return payload
}

async function save(): Promise<void> {
  if (!canSave.value || catalogo.saving.value) return
  const result = await catalogo.save(buildPayload(), editing.value?.id)

  if (result.status === 'ok') {
    modalOpen.value = false
    toast.success(isEdit.value ? 'Cambios guardados' : `Se creó ${props.sustantivo}`)
    await load()
    return
  }

  if (result.status === 'existe-eliminado') {
    // Oferta de reactivación (mejora del PRD sobre el error genérico del legado).
    const alert = await alertController.create({
      header: 'Ya existió con ese nombre',
      message: `${result.message} ¿Querés reactivarlo con sus datos anteriores?`,
      buttons: [
        { text: 'No, elijo otro nombre', role: 'cancel' },
        {
          text: 'Reactivar',
          handler: async () => {
            const r = await catalogo.restore(result.deletedId)
            if (!r.ok) { toast.error(r.message); return }
            modalOpen.value = false
            toast.success('Registro reactivado')
            await load()
          },
        },
      ],
    })
    await alert.present()
    return
  }

  formError.value = result.message
}

async function toggle(row: CatalogoRow): Promise<void> {
  const r = await catalogo.toggleActive(row.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success(r.row?.activo ? 'Activado' : 'Desactivado')
  await load()
}

async function confirmDelete(row: CatalogoRow): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar',
    message: `¿Eliminar «${row.nombre}»?`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar',
        role: 'destructive',
        handler: async () => {
          const r = await catalogo.remove(row.id)
          // El 409 de protección llega con el motivo exacto (ej. "tiene 3 servicio(s)").
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Eliminado')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

// onIonViewWillEnter NO se dispara acá cuando esta página es hija del componente ruteado
// (Ionic registra los hooks en el componente de la ruta). onMounted cubre la primera carga;
// el hook de Ionic cubre las re-entradas a páginas cacheadas cuando sí aplica.
let loadedOnce = false
onMounted(() => { loadedOnce = true; void load() })
onIonViewWillEnter(() => { if (loadedOnce) void load(); else { loadedOnce = true; void load() } })

defineExpose({ reload: load })
</script>

<template>
  <IonPage>
    <IonHeader class="ion-no-border">
      <IonToolbar class="app-toolbar">
        <IonButtons slot="start" class="lg:hidden">
          <IonMenuButton />
        </IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent class="page-content">
      <div class="max-w-5xl mx-auto px-5 lg:px-8 py-6 ds-enter">

        <header class="flex items-center justify-between gap-4 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">{{ titulo }}</h1>
            <p class="mt-0.5 text-sm text-ink-soft">{{ subtitulo }}</p>
          </div>
          <button v-if="meStore.can(cap('create'))" class="ds-btn-primary" @click="openCreate">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nuevo
          </button>
        </header>

        <div class="relative max-w-xs mb-4">
          <IonIcon :icon="searchOutline" class="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint pointer-events-none" />
          <input v-model="search" class="ds-input h-9 pl-9" type="search" placeholder="Buscar…" @input="onSearch" />
        </div>

        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th v-for="col in columnas" :key="col.key">{{ col.label }}</th>
                <th>Estado</th>
                <th class="w-28"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="catalogo.loading.value && !catalogo.rows.value.length">
              <tr v-for="i in 4" :key="i">
                <td :colspan="columnas.length + 2" class="!px-3">
                  <div class="ds-skeleton h-5 w-full my-2"></div>
                </td>
              </tr>
            </tbody>

            <tbody v-else-if="catalogo.rows.value.length">
              <tr v-for="row in catalogo.rows.value" :key="row.id" :class="{ 'opacity-50': row.activo === false }">
                <td v-for="col in columnas" :key="col.key">
                  <slot :name="`cell-${col.key}`" :row="row">
                    <span :class="{ 'font-medium text-ink': col.key === 'nombre', 'text-ink-soft': col.key !== 'nombre' }">
                      {{ row[col.key] ?? '—' }}
                    </span>
                  </slot>
                </td>
                <td>
                  <span :class="row.activo !== false ? 'ds-badge-ok' : 'ds-badge-neutral'">
                    <span class="w-1.5 h-1.5 rounded-full" :class="row.activo !== false ? 'bg-ok' : 'bg-ink-faint'"></span>
                    {{ row.activo !== false ? 'Activo' : 'Inactivo' }}
                  </span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <button v-if="meStore.can(cap('update'))" class="row-action" title="Editar" aria-label="Editar" @click="openEdit(row)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can(cap('toggle'))" class="row-action" :title="row.activo ? 'Desactivar' : 'Activar'" aria-label="Activar o desactivar" @click="toggle(row)">
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can(cap('delete'))" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="confirmDelete(row)">
                      <IonIcon :icon="trashOutline" class="text-[15px]" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>

            <tbody v-else>
              <tr>
                <td :colspan="columnas.length + 2" class="!h-auto">
                  <div class="flex flex-col items-center py-12 text-center">
                    <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
                      <IonIcon :icon="fileTrayOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">{{ search ? 'Sin resultados' : 'Todavía no hay registros' }}</p>
                    <p class="text-xs text-ink-faint mt-1">{{ search ? 'Probá con otra búsqueda.' : 'Creá el primero con «Nuevo».' }}</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="catalogo.meta.value && catalogo.meta.value.totalPages > 1" class="flex items-center justify-between mt-3 text-xs text-ink-soft">
          <span class="tnum">{{ catalogo.meta.value.totalItems }} registro(s)</span>
          <div class="flex gap-1">
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!catalogo.meta.value.hasPrevPage" @click="page--; load()">Anterior</button>
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!catalogo.meta.value.hasNextPage" @click="page++; load()">Siguiente</button>
          </div>
        </div>
      </div>

      <!-- Modal alta/edición -->
      <Teleport defer to="ion-app">
        <div v-if="modalOpen" class="ds-modal-backdrop" @click.self="modalOpen = false">
          <div class="ds-modal ds-enter" role="dialog" aria-modal="true" :aria-label="isEdit ? `Editar ${sustantivo}` : `Nuevo ${sustantivo}`">
            <header class="flex items-center justify-between px-5 h-12 border-b border-line">
              <h2 class="text-sm font-semibold text-ink">
                {{ isEdit ? `Editar ${sustantivo}` : `Crear ${sustantivo}` }}
              </h2>
              <button class="row-action" aria-label="Cerrar" @click="modalOpen = false">
                <IonIcon :icon="closeOutline" class="text-[17px]" />
              </button>
            </header>

            <form class="p-5 space-y-4" @submit.prevent="save">
              <div class="grid grid-cols-2 gap-3">
                <div v-for="campo in campos" :key="campo.key" :class="{ 'col-span-2': campo.full || campo.type === 'textarea' }">
                  <label class="ds-label" :for="`f-${campo.key}`">{{ campo.label }}</label>

                  <textarea
                    v-if="campo.type === 'textarea'"
                    :id="`f-${campo.key}`"
                    v-model="(form[campo.key] as string)"
                    class="ds-input !h-auto min-h-[72px] py-2"
                    rows="3"
                  ></textarea>

                  <select
                    v-else-if="campo.type === 'select'"
                    :id="`f-${campo.key}`"
                    v-model="form[campo.key]"
                    class="ds-input"
                  >
                    <option :value="0">— Sin asignar —</option>
                    <option v-for="opt in campo.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                  </select>

                  <input
                    v-else
                    :id="`f-${campo.key}`"
                    v-model="form[campo.key]"
                    class="ds-input"
                    :type="campo.type || 'text'"
                    :required="campo.required"
                  />

                  <p v-if="campo.hint" class="ds-hint">{{ campo.hint }}</p>
                </div>
              </div>

              <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>

              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalOpen = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!canSave || catalogo.saving.value">
                  {{ catalogo.saving.value ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear') }}
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
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: rgb(var(--s-ink-faint));
  transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
</style>
