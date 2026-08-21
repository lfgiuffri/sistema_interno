<script setup lang="ts">
/**
 * Administración de los espacios de DOCUMENTACIÓN: ABM + matriz de accesos por usuario.
 * Espejo de la pantalla de espacios de trabajo, sobre las tablas propias del módulo
 * (`doc_espacios` / `usuario_doc_espacios`) y con las capabilities `doc-espacios:*`.
 */
import { ref, onMounted } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  addOutline, createOutline, trashOutline, peopleOutline, powerOutline, libraryOutline,
} from 'ionicons/icons'
import { useDocumentacionStore, type DocEspacio, type FilaMatrizDocEspacio } from '@/stores/documentacion'
import ThOrdenable from '@/components/shared/ThOrdenable.vue'
import { useOrdenTabla } from '@/composables/useOrdenTabla'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'

const store = useDocumentacionStore()
// Igual que en espacios de tareas: la columna de accesos ordena por cantidad.
const orden = useOrdenTabla(
  () => store.espacios,
  (e, col) => (col === 'usuarios'
    ? (e.usuarios?.length ?? 0)
    : (e as unknown as Record<string, string | number | boolean | null>)[col]),
)

const meStore = useMeStore()
const toast = useToast()

const modalForm = ref(false)
const editando = ref<DocEspacio | null>(null)
const form = ref({ nombre: '', descripcion: '' })
const formError = ref('')
useEscapeToClose(modalForm, () => { modalForm.value = false })

const modalMatriz = ref(false)
const matrizDe = ref<DocEspacio | null>(null)
const matriz = ref<FilaMatrizDocEspacio[]>([])
const matrizGuardando = ref(false)
useEscapeToClose(modalMatriz, () => { modalMatriz.value = false })

/** Texto del acceso de un usuario para el tooltip del listado. */
const etiquetaAcceso = (u: { ver: boolean; editar: boolean }): string =>
  (u.editar ? 've y edita' : u.ver ? 'solo ve' : 'sin acceso')

function abrirForm(e?: DocEspacio): void {
  editando.value = e ?? null
  form.value = { nombre: e?.nombre ?? '', descripcion: e?.descripcion ?? '' }
  formError.value = ''
  modalForm.value = true
}

async function guardar(): Promise<void> {
  formError.value = ''
  const r = await store.saveEspacio({ ...form.value }, editando.value?.id)

  if (!r.ok) {
    // 409 EXISTE_ELIMINADO: hubo un espacio con ese nombre, se ofrece reactivarlo.
    if (r.errorCode === 'EXISTE_ELIMINADO' && r.deletedId && confirm(`${r.message}\n\n¿Reactivarlo?`)) {
      const rr = await store.restoreEspacio(r.deletedId)
      if (rr.ok) { toast.success('Espacio reactivado'); modalForm.value = false; await store.fetchEspaciosAdmin() }
      else formError.value = rr.message
      return
    }
    formError.value = r.message
    return
  }

  toast.success(editando.value ? 'Espacio actualizado' : 'Espacio creado')
  modalForm.value = false
  await store.fetchEspaciosAdmin()
}

async function toggle(e: DocEspacio): Promise<void> {
  const r = await store.toggleEspacio(e.id)
  if (!r.ok) { toast.error(r.message); return }
  await store.fetchEspaciosAdmin()
}

async function confirmDelete(e: DocEspacio): Promise<void> {
  if (!confirm(`¿Eliminar el espacio «${e.nombre}»?`)) return
  const r = await store.removeEspacio(e.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Espacio eliminado')
  await store.fetchEspaciosAdmin()
}

// ── Matriz de accesos (eje espacio) ──

async function abrirMatriz(e: DocEspacio): Promise<void> {
  matrizDe.value = e
  matriz.value = (await store.fetchAccesos(e.id)) ?? []
  modalMatriz.value = true
}

/** Ver desmarcado ⇒ tampoco edita (editar implica ver). */
function onVer(fila: FilaMatrizDocEspacio): void {
  if (!fila.ver) fila.editar = false
}

/** Editar marcado ⇒ implica ver. */
function onEditar(fila: FilaMatrizDocEspacio): void {
  if (fila.editar) fila.ver = true
}

async function guardarMatriz(): Promise<void> {
  if (!matrizDe.value) return
  matrizGuardando.value = true
  const accesos = matriz.value
    .filter(f => !f.porRol)
    .map(f => ({ userId: f.userId, ver: f.ver, editar: f.editar }))
  const r = await store.saveAccesos(matrizDe.value.id, accesos)
  matrizGuardando.value = false
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Accesos actualizados')
  modalMatriz.value = false
  await store.fetchEspaciosAdmin()
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void store.fetchEspaciosAdmin() })
onIonViewWillEnter(() => { if (loadedOnce) void store.fetchEspaciosAdmin() })
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

        <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Espacios de documentación</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Contenedores de listas y documentos, con acceso por usuario.</p>
          </div>
          <button v-if="meStore.can('doc-espacios:create')" class="ds-btn-primary flex items-center gap-1.5" @click="abrirForm()">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nuevo espacio
          </button>
        </header>

        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <ThOrdenable columna="nombre" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Espacio</ThOrdenable>
                <ThOrdenable columna="listasCount" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Listas</ThOrdenable>
                <ThOrdenable columna="documentosCount" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Documentos</ThOrdenable>
                <ThOrdenable columna="usuarios" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Usuarios con acceso</ThOrdenable>
                <ThOrdenable columna="activo" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Estado</ThOrdenable>
                <th class="w-28"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="store.loading && !store.espacios.length">
              <tr v-for="i in 3" :key="i"><td colspan="6" class="!px-3"><div class="ds-skeleton h-5 w-full my-2"></div></td></tr>
            </tbody>

            <tbody v-else-if="store.espacios.length">
              <tr v-for="e in orden.ordenadas.value" :key="e.id" :class="{ 'opacity-50': !e.activo }">
                <td>
                  <p class="font-medium text-ink">{{ e.nombre }}</p>
                  <p v-if="e.descripcion" class="text-2xs text-ink-faint">{{ e.descripcion }}</p>
                </td>
                <td class="tnum text-ink-soft">{{ e.listasCount }}</td>
                <td class="tnum text-ink-soft">{{ e.documentosCount }}</td>
                <td>
                  <div class="flex flex-wrap gap-1 max-w-xs">
                    <span
                      v-for="u in (e.usuarios ?? []).slice(0, 5)"
                      :key="`${u.id}-${u.porRol}`"
                      :class="u.porRol ? 'ds-badge-ok' : 'ds-badge-neutral'"
                      :title="`${u.nombre}: ${u.porRol ? 'entra por su rol de acceso total' : etiquetaAcceso(u)}`"
                    >
                      {{ u.nombre }}{{ u.activo ? '' : ' (inactivo)' }}
                    </span>
                    <span v-if="(e.usuarios ?? []).length > 5" class="ds-badge-neutral tnum">+{{ (e.usuarios ?? []).length - 5 }}</span>
                    <span v-if="!(e.usuarios ?? []).length" class="text-2xs text-ink-faint">nadie asignado</span>
                  </div>
                </td>
                <td>
                  <span :class="e.activo ? 'ds-badge-ok' : 'ds-badge-neutral'">{{ e.activo ? 'Activo' : 'Inactivo' }}</span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <button v-if="meStore.can('doc-espacios:asignar-usuarios')" class="row-action" title="Accesos" aria-label="Accesos" @click="abrirMatriz(e)">
                      <IonIcon :icon="peopleOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('doc-espacios:update')" class="row-action" title="Editar" aria-label="Editar" @click="abrirForm(e)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('doc-espacios:toggle')" class="row-action" :title="e.activo ? 'Desactivar' : 'Activar'" aria-label="Activar o desactivar" @click="toggle(e)">
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('doc-espacios:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="confirmDelete(e)">
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
                      <IonIcon :icon="libraryOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">No hay espacios de documentación</p>
                    <p class="text-xs text-ink-faint mt-1">Creá el primero para empezar a cargar documentación.</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-2xs text-ink-faint mt-2">
          Un espacio inactivo no aparece en Documentación, pero conserva sus listas y documentos.
          Son independientes de los espacios de trabajo de Tareas.
        </p>
      </div>

      <!-- Modal alta/edición -->
      <Teleport defer to="ion-app">
        <div v-if="modalForm" class="ds-modal-backdrop" @click.self="modalForm = false">
          <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" :aria-label="editando ? 'Editar espacio' : 'Nuevo espacio'">
            <h2 class="text-base font-semibold text-ink mb-3">{{ editando ? 'Editar espacio' : 'Nuevo espacio de documentación' }}</h2>
            <form class="space-y-3" @submit.prevent="guardar">
              <div>
                <label class="ds-label" for="de-nombre">Nombre</label>
                <input id="de-nombre" v-model="form.nombre" class="ds-input" type="text" required maxlength="100" />
              </div>
              <div>
                <label class="ds-label" for="de-desc">Descripción</label>
                <input id="de-desc" v-model="form.descripcion" class="ds-input" type="text" maxlength="255" />
              </div>
              <p v-if="!editando" class="ds-hint">Vas a quedar con acceso total al espacio que crees.</p>
              <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalForm = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!form.nombre.trim()">
                  {{ editando ? 'Guardar' : 'Crear espacio' }}
                </button>
              </footer>
            </form>
          </div>
        </div>
      </Teleport>

      <!-- Modal matriz (eje espacio) -->
      <Teleport defer to="ion-app">
        <div v-if="modalMatriz" class="ds-modal-backdrop" @click.self="modalMatriz = false">
          <div class="ds-modal max-w-md" role="dialog" aria-modal="true" aria-label="Accesos del espacio">
            <h2 class="text-base font-semibold text-ink mb-1">Accesos · {{ matrizDe?.nombre }}</h2>
            <p class="text-xs text-ink-soft mb-3">Editar implica ver. Los administradores entran por su rol: guardar no los afecta.</p>

            <div class="border border-line rounded-lg divide-y divide-line-soft max-h-72 overflow-y-auto">
              <div v-for="fila in matriz" :key="fila.userId" class="flex items-center gap-3 px-3 h-10" :class="{ 'opacity-60': !fila.activo }">
                <span class="flex-1 text-sm text-ink truncate">
                  {{ fila.nombre }}{{ fila.activo ? '' : ' (inactivo)' }}
                </span>
                <template v-if="fila.porRol">
                  <span class="ds-badge-ok">entra por su rol</span>
                </template>
                <template v-else>
                  <label class="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
                    <input v-model="fila.ver" type="checkbox" class="accent-[#0F7660]" @change="onVer(fila)" /> Ve
                  </label>
                  <label class="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
                    <input v-model="fila.editar" type="checkbox" class="accent-[#0F7660]" @change="onEditar(fila)" /> Edita
                  </label>
                </template>
              </div>
            </div>

            <footer class="flex justify-end gap-2 pt-3">
              <button type="button" class="ds-btn-secondary" @click="modalMatriz = false">Cancelar</button>
              <button type="button" class="ds-btn-primary" :disabled="matrizGuardando" @click="guardarMatriz">
                {{ matrizGuardando ? 'Guardando…' : 'Guardar accesos' }}
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
</style>
