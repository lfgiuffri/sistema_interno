<script setup lang="ts">
/**
 * Usuarios — ABM completo (Fase 0).
 *
 * Tabla paginada con búsqueda, alta/edición en modal, toggle de activo y baja lógica.
 * Cada acción se gatea con su capability (`usuarios:*`); las protecciones duras
 * (último admin, auto-protecciones, unicidad) las aplica el backend y sus mensajes
 * se muestran tal cual.
 */
import { ref, computed } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  addOutline, searchOutline, createOutline, trashOutline, powerOutline,
  peopleOutline, closeOutline, albumsOutline,
} from 'ionicons/icons'
import UsuarioEspaciosModal from '@/components/espacios/UsuarioEspaciosModal.vue'
import { useUsersStore } from '@/stores/users'
import { useRolesStore } from '@/stores/roles'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import type { User, UserInput } from '@/types'

const usersStore = useUsersStore()
const rolesStore = useRolesStore()
const meStore = useMeStore()
const toast = useToast()

const search = ref('')
const page = ref(1)
let searchTimer: ReturnType<typeof setTimeout> | null = null

// ── Modal de alta/edición ──
const modalOpen = ref(false)
useEscapeToClose(modalOpen, () => { modalOpen.value = false })
const editing = ref<User | null>(null)
const form = ref<UserInput>({ name: '', lastName: '', email: '', username: '', password: '', roleId: 0 })
const formError = ref('')

const isEdit = computed(() => editing.value !== null)

// ── Matriz de espacios del usuario (eje usuario) ──
const espaciosModal = ref(false)
const espaciosDe = ref<User | null>(null)
function abrirEspacios(user: User): void {
  espaciosDe.value = user
  espaciosModal.value = true
}
const canSave = computed(() =>
  form.value.name.trim() && form.value.lastName.trim() && form.value.email.trim()
  && form.value.username.trim() && form.value.roleId > 0
  && (isEdit.value || (form.value.password ?? '').length >= 8)
)

async function load(): Promise<void> {
  await usersStore.fetchUsers({ page: page.value, search: search.value })
}

function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; void load() }, 250)
}

function openCreate(): void {
  editing.value = null
  form.value = { name: '', lastName: '', email: '', username: '', password: '', roleId: 0 }
  formError.value = ''
  modalOpen.value = true
}

function openEdit(user: User): void {
  editing.value = user
  form.value = {
    name: user.name,
    lastName: user.lastName ?? '',
    email: user.email ?? '',
    username: user.username,
    password: '',
    roleId: user.roleId ?? 0,
  }
  formError.value = ''
  modalOpen.value = true
}

async function save(): Promise<void> {
  if (!canSave.value || usersStore.saving) return
  // Validación local de contraseña en edición: vacía = conservar; si viene, mínimo 8.
  if (isEdit.value && form.value.password && form.value.password.length < 8) {
    formError.value = 'La nueva contraseña debe tener al menos 8 caracteres'
    return
  }
  const payload: UserInput = { ...form.value }
  if (isEdit.value && !payload.password) delete payload.password

  const saved = await usersStore.saveUser(payload, editing.value?.id)
  if (!saved) { formError.value = usersStore.error; return }
  modalOpen.value = false
  toast.success(isEdit.value ? 'Usuario actualizado' : 'Usuario creado')
  await load()
}

async function toggle(user: User): Promise<void> {
  const updated = await usersStore.toggleActive(user.id)
  if (!updated) { toast.error(usersStore.error); return }
  toast.success(updated.active ? 'Usuario activado' : 'Usuario desactivado')
  await load()
}

async function confirmDelete(user: User): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar usuario',
    message: `¿Eliminar a ${user.name} ${user.lastName ?? ''}? Podés desactivarlo si es temporal.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar',
        role: 'destructive',
        handler: async () => {
          const ok = await usersStore.deleteUser(user.id)
          if (!ok) { toast.error(usersStore.error); return }
          toast.success('Usuario eliminado')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

onIonViewWillEnter(() => {
  void load()
  if (!rolesStore.roles.length) void rolesStore.fetchRoles()
})
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

        <!-- Encabezado -->
        <header class="flex items-center justify-between gap-4 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Usuarios</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Quién entra al sistema y con qué rol.</p>
          </div>
          <button v-if="meStore.can('usuarios:create')" class="ds-btn-primary" @click="openCreate">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nuevo usuario
          </button>
        </header>

        <!-- Búsqueda -->
        <div class="relative max-w-xs mb-4">
          <IonIcon :icon="searchOutline" class="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint pointer-events-none" />
          <input
            v-model="search"
            class="ds-input h-9 pl-9"
            type="search"
            placeholder="Buscar por nombre, email, usuario…"
            @input="onSearch"
          />
        </div>

        <!-- Tabla -->
        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th class="w-28"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <!-- Cargando: skeleton con la misma forma -->
            <tbody v-if="usersStore.loading && !usersStore.users.length">
              <tr v-for="i in 4" :key="i">
                <td colspan="5" class="!px-3">
                  <div class="ds-skeleton h-5 w-full my-2"></div>
                </td>
              </tr>
            </tbody>

            <tbody v-else-if="usersStore.users.length">
              <tr v-for="user in usersStore.users" :key="user.id" :class="{ 'opacity-50': user.active === false }">
                <td>
                  <div class="flex items-center gap-2.5">
                    <div class="w-7 h-7 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-2xs font-semibold shrink-0">
                      {{ (user.name?.charAt(0) ?? '') + (user.lastName?.charAt(0) ?? '') }}
                    </div>
                    <div class="leading-tight min-w-0">
                      <p class="font-medium text-ink truncate">{{ user.name }} {{ user.lastName }}</p>
                      <p class="text-2xs text-ink-faint font-mono">@{{ user.username }}</p>
                    </div>
                  </div>
                </td>
                <td class="text-ink-soft">{{ user.email }}</td>
                <td>
                  <span v-if="user.role" class="ds-badge-neutral">{{ user.role.label }}</span>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td>
                  <span :class="user.active !== false ? 'ds-badge-ok' : 'ds-badge-neutral'">
                    <span class="w-1.5 h-1.5 rounded-full" :class="user.active !== false ? 'bg-ok' : 'bg-ink-faint'"></span>
                    {{ user.active !== false ? 'Activo' : 'Inactivo' }}
                  </span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <button
                      v-if="meStore.can('espacios:asignar-usuarios')"
                      class="row-action" title="Espacios de trabajo" aria-label="Espacios de trabajo"
                      @click="abrirEspacios(user)"
                    >
                      <IonIcon :icon="albumsOutline" class="text-[15px]" />
                    </button>
                    <button
                      v-if="meStore.can('usuarios:update')"
                      class="row-action" title="Editar" aria-label="Editar usuario"
                      @click="openEdit(user)"
                    >
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button
                      v-if="meStore.can('usuarios:toggle') && user.id !== meStore.user?.id"
                      class="row-action" :title="user.active !== false ? 'Desactivar' : 'Activar'"
                      aria-label="Activar o desactivar usuario"
                      @click="toggle(user)"
                    >
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button
                      v-if="meStore.can('usuarios:delete') && user.id !== meStore.user?.id"
                      class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar usuario"
                      @click="confirmDelete(user)"
                    >
                      <IonIcon :icon="trashOutline" class="text-[15px]" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>

            <!-- Vacío -->
            <tbody v-else>
              <tr>
                <td colspan="5" class="!h-auto">
                  <div class="flex flex-col items-center py-12 text-center">
                    <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
                      <IonIcon :icon="peopleOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">
                      {{ search ? 'Sin resultados' : 'Todavía no hay usuarios' }}
                    </p>
                    <p class="text-xs text-ink-faint mt-1">
                      {{ search ? 'Probá con otra búsqueda.' : 'Creá el primero con «Nuevo usuario».' }}
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Paginación -->
        <div v-if="usersStore.paginate && usersStore.paginate.totalPages > 1" class="flex items-center justify-between mt-3 text-xs text-ink-soft">
          <span>{{ usersStore.paginate.totalItems }} usuario(s)</span>
          <div class="flex gap-1">
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!usersStore.paginate.hasPrevPage" @click="page--; load()">Anterior</button>
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!usersStore.paginate.hasNextPage" @click="page++; load()">Siguiente</button>
          </div>
        </div>
      </div>

      <!-- Modal alta/edición -->
      <Teleport defer to="ion-app">
        <div v-if="modalOpen" class="ds-modal-backdrop" @click.self="modalOpen = false">
          <div class="ds-modal ds-enter" role="dialog" aria-modal="true" :aria-label="isEdit ? 'Editar usuario' : 'Nuevo usuario'">
            <header class="flex items-center justify-between px-5 h-12 border-b border-line">
              <h2 class="text-sm font-semibold text-ink">{{ isEdit ? 'Editar usuario' : 'Nuevo usuario' }}</h2>
              <button class="row-action" aria-label="Cerrar" @click="modalOpen = false">
                <IonIcon :icon="closeOutline" class="text-[17px]" />
              </button>
            </header>

            <form class="p-5 space-y-4" @submit.prevent="save">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="ds-label" for="u-name">Nombre</label>
                  <input id="u-name" v-model="form.name" class="ds-input" type="text" required />
                </div>
                <div>
                  <label class="ds-label" for="u-lastname">Apellido</label>
                  <input id="u-lastname" v-model="form.lastName" class="ds-input" type="text" required />
                </div>
              </div>
              <div>
                <label class="ds-label" for="u-email">Email</label>
                <input id="u-email" v-model="form.email" class="ds-input" type="email" required />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="ds-label" for="u-username">Usuario</label>
                  <input id="u-username" v-model="form.username" class="ds-input font-mono" type="text" autocapitalize="off" spellcheck="false" required />
                </div>
                <div>
                  <label class="ds-label" for="u-pass">
                    {{ isEdit ? 'Nueva contraseña' : 'Contraseña' }}
                  </label>
                  <input id="u-pass" v-model="form.password" class="ds-input" type="password" autocomplete="new-password" />
                  <p class="ds-hint">{{ isEdit ? 'Dejala vacía para no cambiarla.' : 'Mínimo 8 caracteres.' }}</p>
                </div>
              </div>
              <div>
                <label class="ds-label" for="u-role">Rol</label>
                <select id="u-role" v-model.number="form.roleId" class="ds-input" required>
                  <option :value="0" disabled>Elegí un rol…</option>
                  <option v-for="role in rolesStore.roles" :key="role.id" :value="role.id">
                    {{ role.label }}
                  </option>
                </select>
              </div>

              <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>

              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalOpen = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!canSave || usersStore.saving">
                  {{ usersStore.saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear usuario') }}
                </button>
              </footer>
            </form>
          </div>
        </div>
      </Teleport>
      <UsuarioEspaciosModal
        :open="espaciosModal"
        :user-id="espaciosDe?.id ?? 0"
        :user-nombre="espaciosDe ? `${espaciosDe.name} ${espaciosDe.lastName}` : ''"
        @close="espaciosModal = false"
      />
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

