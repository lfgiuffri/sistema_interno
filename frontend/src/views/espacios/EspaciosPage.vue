<script setup lang="ts">
/**
 * Administración de espacios de trabajo: ABM protegido + matriz de accesos (eje espacio).
 * Los admins figuran informativos ("entra por su rol") y nunca se tocan desde acá.
 */
import { ref, onMounted } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  addOutline, createOutline, trashOutline, powerOutline, peopleOutline, albumsOutline,
} from 'ionicons/icons'
import { useEspaciosStore, type Espacio, type FilaMatrizEspacio } from '@/stores/espacios'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'

const espaciosStore = useEspaciosStore()
const meStore = useMeStore()
const toast = useToast()

const modalForm = ref(false)
const editando = ref<Espacio | null>(null)
const form = ref({ nombre: '', descripcion: '' })
const formError = ref('')
useEscapeToClose(modalForm, () => { modalForm.value = false })

const modalMatriz = ref(false)
const matrizDe = ref<Espacio | null>(null)
const matriz = ref<FilaMatrizEspacio[]>([])
const matrizGuardando = ref(false)
useEscapeToClose(modalMatriz, () => { modalMatriz.value = false })

function abrirForm(e?: Espacio): void {
  editando.value = e ?? null
  form.value = { nombre: e?.nombre ?? '', descripcion: e?.descripcion ?? '' }
  formError.value = ''
  modalForm.value = true
}

async function guardar(): Promise<void> {
  if (!form.value.nombre.trim()) return
  const r = await espaciosStore.save({
    nombre: form.value.nombre.trim(),
    descripcion: form.value.descripcion.trim() || undefined,
  }, editando.value?.id)

  if (!r.ok) {
    if (r.errorCode === 'EXISTE_ELIMINADO' && r.deletedId) {
      modalForm.value = false
      const alert = await alertController.create({
        header: 'Espacio eliminado encontrado',
        message: r.message,
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          {
            text: 'Reactivar',
            handler: async () => {
              const rr = await espaciosStore.restore(r.deletedId as number)
              if (!rr.ok) { toast.error(rr.message); return }
              toast.success('Espacio reactivado')
              await espaciosStore.fetchAll()
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
  toast.success(editando.value ? 'Espacio de trabajo actualizado' : 'Espacio de trabajo creado')
  modalForm.value = false
  await espaciosStore.fetchAll()
}

async function toggle(e: Espacio): Promise<void> {
  const r = await espaciosStore.toggle(e.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Estado del espacio cambiado')
  await espaciosStore.fetchAll()
}

async function confirmDelete(e: Espacio): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar espacio',
    message: `¿Eliminar «${e.nombre}»? Si tiene listas o tareas no se puede eliminar.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await espaciosStore.remove(e.id)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Espacio de trabajo eliminado')
          await espaciosStore.fetchAll()
        },
      },
    ],
  })
  await alert.present()
}

async function abrirMatriz(e: Espacio): Promise<void> {
  matrizDe.value = e
  const filas = await espaciosStore.fetchMatriz(e.id)
  if (!filas) { toast.error('No se pudo cargar la matriz'); return }
  matriz.value = filas
  modalMatriz.value = true
}

/** editar⇒ver en el cliente (el servidor lo fuerza igual). */
function onEditar(fila: FilaMatrizEspacio): void {
  if (fila.editar) fila.ver = true
}
function onVer(fila: FilaMatrizEspacio): void {
  if (!fila.ver) fila.editar = false
}

async function guardarMatriz(): Promise<void> {
  if (!matrizDe.value || matrizGuardando.value) return
  matrizGuardando.value = true
  const r = await espaciosStore.saveMatriz(
    matrizDe.value.id,
    matriz.value.filter(f => !f.porRol).map(f => ({ userId: f.userId, ver: f.ver, editar: f.editar })),
  )
  matrizGuardando.value = false
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Accesos del espacio actualizados')
  modalMatriz.value = false
  await espaciosStore.fetchAll()
}

/** Etiqueta de acceso de un usuario (leyendas del legado). */
function etiquetaAcceso(u: { porRol: boolean; ver: boolean; editar: boolean }): string {
  if (u.porRol) return 'por su rol'
  if (u.editar) return 've y edita'
  return 'solo ve'
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void espaciosStore.fetchAll() })
onIonViewWillEnter(() => { if (loadedOnce) void espaciosStore.fetchAll() })
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

        <header class="flex items-center justify-between gap-4 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Espacios de trabajo</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Contenedores de listas y tareas, con acceso por usuario.</p>
          </div>
          <button v-if="meStore.can('espacios:create')" class="ds-btn-primary" @click="abrirForm()">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nuevo espacio
          </button>
        </header>

        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th>Espacio</th>
                <th>Listas</th>
                <th>Tareas</th>
                <th>Usuarios con acceso</th>
                <th>Estado</th>
                <th class="w-28"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="espaciosStore.loading && !espaciosStore.rows.length">
              <tr v-for="i in 3" :key="i"><td colspan="6" class="!px-3"><div class="ds-skeleton h-5 w-full my-2"></div></td></tr>
            </tbody>

            <tbody v-else-if="espaciosStore.rows.length">
              <tr v-for="e in espaciosStore.rows" :key="e.id" :class="{ 'opacity-50': !e.activo }">
                <td>
                  <p class="font-medium text-ink">{{ e.nombre }}</p>
                  <p v-if="e.descripcion" class="text-2xs text-ink-faint">{{ e.descripcion }}</p>
                </td>
                <td class="tnum text-ink-soft">{{ e.listasCount }}</td>
                <td class="tnum text-ink-soft">{{ e.tareasCount }}</td>
                <td>
                  <div class="flex flex-wrap gap-1 max-w-xs">
                    <span
                      v-for="u in e.usuarios.slice(0, 5)"
                      :key="`${u.id}-${u.porRol}`"
                      :class="u.porRol ? 'ds-badge-ok' : 'ds-badge-neutral'"
                      :title="`${u.nombre}: ${u.porRol ? 'entra por su rol de acceso total' : etiquetaAcceso(u)}`"
                    >
                      {{ u.nombre }}{{ u.activo ? '' : ' (inactivo)' }}
                    </span>
                    <span v-if="e.usuarios.length > 5" class="ds-badge-neutral tnum">+{{ e.usuarios.length - 5 }}</span>
                    <span v-if="!e.usuarios.length" class="text-2xs text-ink-faint">nadie asignado</span>
                  </div>
                </td>
                <td>
                  <span :class="e.activo ? 'ds-badge-ok' : 'ds-badge-neutral'">{{ e.activo ? 'Activo' : 'Inactivo' }}</span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <button v-if="meStore.can('espacios:asignar-usuarios')" class="row-action" title="Accesos" aria-label="Accesos" @click="abrirMatriz(e)">
                      <IonIcon :icon="peopleOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('espacios:update')" class="row-action" title="Editar" aria-label="Editar" @click="abrirForm(e)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('espacios:toggle')" class="row-action" :title="e.activo ? 'Desactivar' : 'Activar'" aria-label="Activar o desactivar" @click="toggle(e)">
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('espacios:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="confirmDelete(e)">
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
                      <IonIcon :icon="albumsOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">No hay espacios de trabajo</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-2xs text-ink-faint mt-2">Un espacio inactivo no aparece en Tareas, pero conserva sus listas y tareas.</p>
      </div>

      <!-- Modal alta/edición -->
      <Teleport defer to="ion-app">
        <div v-if="modalForm" class="ds-modal-backdrop" @click.self="modalForm = false">
          <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" :aria-label="editando ? 'Editar espacio' : 'Nuevo espacio'">
            <h2 class="text-base font-semibold text-ink mb-3">{{ editando ? 'Editar espacio' : 'Nuevo espacio de trabajo' }}</h2>
            <form class="space-y-3" @submit.prevent="guardar">
              <div>
                <label class="ds-label" for="es-nombre">Nombre</label>
                <input id="es-nombre" v-model="form.nombre" class="ds-input" type="text" required maxlength="100" />
              </div>
              <div>
                <label class="ds-label" for="es-desc">Descripción</label>
                <input id="es-desc" v-model="form.descripcion" class="ds-input" type="text" maxlength="255" />
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
