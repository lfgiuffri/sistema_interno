<script setup lang="ts">
/**
 * Roles — ABM + matriz de permisos por capability (Fase 0).
 *
 * Cada rol es un set de capabilities agrupadas por módulo. La matriz ofrece un
 * atajo por módulo (todo / nada) y checkboxes finos por acción. El rol
 * Administrador (isSystem) se muestra pero no se edita ni elimina; el comodín `*`
 * no es asignable — reglas que el backend garantiza y la UI refleja.
 */
import { ref, computed } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  addOutline, createOutline, trashOutline, closeOutline,
  shieldCheckmarkOutline, lockClosedOutline,
} from 'ionicons/icons'
import { useRolesStore } from '@/stores/roles'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import type { Role, RoleInput } from '@/types'

const rolesStore = useRolesStore()
const meStore = useMeStore()
const toast = useToast()

// ── Modal de alta/edición ──
const modalOpen = ref(false)
useEscapeToClose(modalOpen, () => { modalOpen.value = false })
const editing = ref<Role | null>(null)
const form = ref<RoleInput>({ label: '', description: '', capabilities: [] })
const formError = ref('')
const selected = ref<Set<string>>(new Set())

const isEdit = computed(() => editing.value !== null)
const canSave = computed(() => form.value.label.trim().length > 0)

/** Etiquetas legibles para las acciones de capability. */
const ACTION_LABELS: Record<string, string> = {
  read: 'Ver',
  create: 'Crear',
  update: 'Editar',
  toggle: 'Activar/Desactivar',
  delete: 'Eliminar',
  manage: 'Gestionar',
}

/** Nombre legible de una capability (sufijo después de ':'). */
const actionLabel = (cap: string): string => {
  const action = cap.split(':')[1] ?? cap
  return ACTION_LABELS[action] ?? action
}

/**
 * Nombres de módulo que NO se leen bien con la regla automática (o que en el menú se
 * llaman distinto de como se llama su capability).
 */
const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Panel',
  areas: 'Áreas',
  estadisticas: 'Estadísticas',
  'doc-espacios': 'Espacios de documentación',
  documentacion: 'Documentación',
  'formas-facturacion': 'Formas de facturación',
  'empleados-archivos': 'Archivos de empleados',
  espacios: 'Espacios de trabajo',
  configuracion: 'Configuración',
  planificacion: 'Planificación',
  sitios: 'Sitios web',
}

/** Nombre legible del módulo (mapa explícito, o primera letra en mayúscula). */
const moduleLabel = (module: string): string =>
  MODULE_LABELS[module] ?? module.charAt(0).toUpperCase() + module.slice(1).replace(/-/g, ' ')

/** Catálogo ordenado por la etiqueta VISIBLE (el backend lo manda por clave de módulo). */
const catalogoOrdenado = computed(() =>
  [...rolesStore.catalog].sort((a, b) => moduleLabel(a.module).localeCompare(moduleLabel(b.module), 'es')),
)

/** Orden lógico de las acciones dentro de un módulo (el catálogo viene alfabético). */
const ACTION_ORDER = ['read', 'create', 'update', 'toggle', 'delete', 'manage']
const sortCaps = (caps: string[]): string[] =>
  [...caps].sort((a, b) => {
    const ia = ACTION_ORDER.indexOf(a.split(':')[1] ?? '')
    const ib = ACTION_ORDER.indexOf(b.split(':')[1] ?? '')
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

async function load(): Promise<void> {
  await Promise.all([rolesStore.fetchRoles(), rolesStore.fetchCatalog()])
}

function openCreate(): void {
  editing.value = null
  form.value = { label: '', description: '', capabilities: [] }
  selected.value = new Set()
  formError.value = ''
  modalOpen.value = true
}

function openEdit(role: Role): void {
  editing.value = role
  form.value = { label: role.label, description: role.description ?? '', capabilities: [] }
  selected.value = new Set(role.capabilities ?? [])
  formError.value = ''
  modalOpen.value = true
}

function toggleCap(cap: string): void {
  const next = new Set(selected.value)
  if (next.has(cap)) next.delete(cap)
  else next.add(cap)
  selected.value = next
}

/** ¿Todas las capabilities del módulo están seleccionadas? */
const allOfModule = (caps: string[]): boolean => caps.every(c => selected.value.has(c))

/** Atajo por módulo: si están todas, las quita; si no, las agrega todas. */
function toggleModule(caps: string[]): void {
  const next = new Set(selected.value)
  if (allOfModule(caps)) caps.forEach(c => next.delete(c))
  else caps.forEach(c => next.add(c))
  selected.value = next
}

async function save(): Promise<void> {
  if (!canSave.value || rolesStore.saving) return
  const payload: RoleInput = {
    label: form.value.label.trim(),
    description: form.value.description?.trim() || undefined,
    capabilities: [...selected.value],
  }
  const ok = await rolesStore.saveRole(payload, editing.value?.id)
  if (!ok) { formError.value = rolesStore.error; return }
  modalOpen.value = false
  toast.success(isEdit.value ? 'Rol actualizado' : 'Rol creado')
  await load()
}

async function confirmDelete(role: Role): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar rol',
    message: `¿Eliminar el rol «${role.label}»?`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar',
        role: 'destructive',
        handler: async () => {
          const ok = await rolesStore.deleteRole(role.id)
          if (!ok) { toast.error(rolesStore.error); return }
          toast.success('Rol eliminado')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

onIonViewWillEnter(() => { void load() })
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
            <h1 class="text-xl font-semibold tracking-tight text-ink">Roles</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Qué puede ver y hacer cada rol, permiso por permiso.</p>
          </div>
          <button v-if="meStore.can('roles:create')" class="ds-btn-primary" @click="openCreate">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nuevo rol
          </button>
        </header>

        <!-- Cargando -->
        <div v-if="rolesStore.loading && !rolesStore.roles.length" class="space-y-2">
          <div v-for="i in 3" :key="i" class="ds-skeleton h-16 w-full"></div>
        </div>

        <!-- Lista de roles -->
        <div v-else class="ds-card divide-y divide-line-soft">
          <div
            v-for="role in rolesStore.roles"
            :key="role.id"
            class="flex items-center gap-4 px-4 py-3.5"
          >
            <div
              class="w-8 h-8 rounded-md grid place-items-center shrink-0"
              :class="role.isSystem ? 'bg-accent-soft' : 'bg-surface-2'"
            >
              <IonIcon
                :icon="role.isSystem ? lockClosedOutline : shieldCheckmarkOutline"
                class="text-[15px]"
                :class="role.isSystem ? 'text-accent-ink' : 'text-ink-soft'"
              />
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium text-ink">{{ role.label }}</p>
                <span v-if="role.isSystem" class="ds-badge-accent">acceso total</span>
              </div>
              <p class="text-xs text-ink-faint truncate">
                {{ role.description || (role.isSystem ? 'No se puede editar ni eliminar.' : 'Sin descripción') }}
              </p>
            </div>

            <div class="hidden sm:flex items-center gap-4 text-xs text-ink-soft shrink-0">
              <span class="tnum">
                {{ role.isSystem ? 'todos los permisos' : `${(role.capabilities ?? []).length} permiso(s)` }}
              </span>
              <span class="tnum">{{ role.usersCount ?? 0 }} usuario(s)</span>
            </div>

            <div class="flex items-center gap-0.5 shrink-0">
              <button
                v-if="meStore.can('roles:update') && !role.isSystem"
                class="row-action" title="Editar" aria-label="Editar rol"
                @click="openEdit(role)"
              >
                <IonIcon :icon="createOutline" class="text-[15px]" />
              </button>
              <button
                v-if="meStore.can('roles:delete') && !role.isSystem"
                class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar rol"
                @click="confirmDelete(role)"
              >
                <IonIcon :icon="trashOutline" class="text-[15px]" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal alta/edición con matriz -->
      <Teleport defer to="ion-app">
        <div v-if="modalOpen" class="ds-modal-backdrop" @click.self="modalOpen = false">
          <div class="ds-modal !max-w-xl ds-enter" role="dialog" aria-modal="true" :aria-label="isEdit ? 'Editar rol' : 'Nuevo rol'">
            <header class="flex items-center justify-between px-5 h-12 border-b border-line sticky top-0 bg-surface z-10">
              <h2 class="text-sm font-semibold text-ink">{{ isEdit ? `Editar rol · ${editing?.label}` : 'Nuevo rol' }}</h2>
              <button class="row-action" aria-label="Cerrar" @click="modalOpen = false">
                <IonIcon :icon="closeOutline" class="text-[17px]" />
              </button>
            </header>

            <form class="p-5 space-y-5" @submit.prevent="save">
              <div class="grid sm:grid-cols-2 gap-3">
                <div>
                  <label class="ds-label" for="r-label">Nombre del rol</label>
                  <input id="r-label" v-model="form.label" class="ds-input" type="text" required />
                </div>
                <div>
                  <label class="ds-label" for="r-desc">Descripción</label>
                  <input id="r-desc" v-model="form.description" class="ds-input" type="text" placeholder="Opcional" />
                </div>
              </div>

              <!-- Matriz de permisos -->
              <div>
                <p class="ds-label mb-2">Permisos</p>
                <div class="border border-line rounded-lg divide-y divide-line-soft">
                  <div v-for="group in catalogoOrdenado" :key="group.module" class="px-4 py-3">
                    <div class="flex items-center justify-between mb-2">
                      <p class="text-xs font-semibold text-ink">{{ moduleLabel(group.module) }}</p>
                      <button
                        type="button"
                        class="text-2xs font-medium text-accent-ink hover:underline"
                        @click="toggleModule(group.capabilities)"
                      >
                        {{ allOfModule(group.capabilities) ? 'Quitar todo' : 'Todo el módulo' }}
                      </button>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                      <button
                        v-for="cap in sortCaps(group.capabilities)"
                        :key="cap"
                        type="button"
                        class="cap-pill"
                        :class="{ 'cap-pill-on': selected.has(cap) }"
                        :title="cap"
                        @click="toggleCap(cap)"
                      >
                        {{ actionLabel(cap) }}
                      </button>
                    </div>
                  </div>

                  <p v-if="!rolesStore.catalog.length" class="px-4 py-6 text-center text-xs text-ink-faint">
                    No hay permisos declarados todavía.
                  </p>
                </div>
                <p class="ds-hint">
                  Seleccionados: <span class="tnum font-medium">{{ selected.size }}</span>.
                  El acceso total (·) es exclusivo del rol Administrador.
                </p>
              </div>

              <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>

              <footer class="flex justify-end gap-2">
                <button type="button" class="ds-btn-secondary" @click="modalOpen = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!canSave || rolesStore.saving">
                  {{ rolesStore.saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear rol') }}
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

/* Pill de capability: toggle visual claro entre asignada y no. */
.cap-pill {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 450;
  border: 1px solid rgb(var(--s-line));
  color: rgb(var(--s-ink-soft));
  background: rgb(var(--s-surface));
  transition: all 0.12s ease;
}
.cap-pill:hover { border-color: rgb(var(--s-ink-faint)); }
.cap-pill:active { transform: translateY(1px); }
.cap-pill-on {
  background: rgb(var(--s-accent-soft));
  border-color: rgb(var(--s-accent) / 0.35);
  color: rgb(var(--s-accent-ink));
  font-weight: 500;
}
</style>
