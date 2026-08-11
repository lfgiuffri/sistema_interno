<template>
  <SettingSection
    title="Perfil"
    description="Tu cuenta y datos personales"
    :icon="personCircleOutline"
  >
    <div v-if="user" class="user-card">
      <div
        class="user-avatar"
        :style="{ background: user.avatarColor || 'linear-gradient(135deg, #6366f1, #8b5cf6)' }"
      >
        <span>{{ initials }}</span>
      </div>
      <div class="user-info">
        <div class="user-name">{{ user.name }} {{ user.lastName || '' }}</div>
        <div class="user-email">{{ user.email || user.username }}</div>
      </div>
      <button v-if="!editing" class="action-btn-ghost edit-toggle" @click="startEdit">
        <ion-icon :icon="createOutline" /> Editar
      </button>
    </div>

    <div v-if="editing" class="edit-form">
      <div class="form-row">
        <div class="form-field">
          <label>Nombre</label>
          <input v-model="form.name" type="text" class="form-input" placeholder="Tu nombre" />
        </div>
        <div class="form-field">
          <label>Apellido</label>
          <input v-model="form.lastName" type="text" class="form-input" placeholder="Tu apellido" />
        </div>
      </div>
      <div class="form-field">
        <label>Email</label>
        <input v-model="form.email" type="email" class="form-input" placeholder="email@ejemplo.com" />
      </div>
      <div class="form-field">
        <label>Nueva contraseña <span class="hint-inline">(dejá vacío para no cambiar)</span></label>
        <input v-model="form.password" type="password" class="form-input" placeholder="••••••" autocomplete="new-password" />
      </div>

      <div class="form-actions">
        <button class="action-btn-primary" :disabled="saving" @click="saveProfile">
          <ion-icon :icon="checkmarkOutline" /> {{ saving ? 'Guardando...' : 'Guardar cambios' }}
        </button>
        <button class="action-btn-ghost" :disabled="saving" @click="cancelEdit">Cancelar</button>
      </div>
    </div>

    <SettingRow label="Cerrar sesión" hint="Vas a tener que volver a iniciar sesión la próxima vez">
      <button class="action-btn-danger logout-btn" @click="showLogoutConfirm = true">
        <ion-icon :icon="exitOutline" /> Salir
      </button>
    </SettingRow>
  </SettingSection>

  <AppModal v-if="showLogoutConfirm" title="Cerrar sesión" @close="showLogoutConfirm = false">
    <p class="confirm-msg">¿Estás seguro de que querés cerrar sesión?</p>
    <div class="modal-actions">
      <button class="action-btn-danger-solid modal-action-btn" @click="doLogout">Salir</button>
      <button class="action-btn-ghost" @click="showLogoutConfirm = false">Cancelar</button>
    </div>
  </AppModal>
</template>

<script setup lang="ts">
/** Sección de perfil: ver/editar datos del usuario y cerrar sesión. */
import { ref, reactive, computed } from 'vue'
import { IonIcon } from '@ionic/vue'
import { personCircleOutline, exitOutline, createOutline, checkmarkOutline } from 'ionicons/icons'
import { useRouter } from 'vue-router'
import SettingSection from '@/components/settings/SettingSection.vue'
import SettingRow from '@/components/settings/SettingRow.vue'
import AppModal from '@/components/shared/AppModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import api from '@/services/api'

const authStore = useAuthStore()
const meStore = useMeStore()
const router = useRouter()
const toast = useToast()

const showLogoutConfirm = ref(false)
const editing = ref(false)
const saving = ref(false)

const user = computed(() => meStore.user)

const initials = computed(() => {
  const u = user.value
  if (!u) return '?'
  const a = (u.name || '').charAt(0)
  const b = (u.lastName || '').charAt(0)
  return (a + b).toUpperCase() || u.username?.charAt(0).toUpperCase() || '?'
})

const form = reactive<{ name: string; lastName: string; email: string; password: string }>({
  name: '', lastName: '', email: '', password: '',
})

/** Carga el formulario con los datos actuales y entra en modo edición. */
function startEdit() {
  if (!user.value) return
  form.name = user.value.name || ''
  form.lastName = user.value.lastName || ''
  form.email = user.value.email || ''
  form.password = ''
  editing.value = true
}

/** Cancela la edición sin guardar. */
function cancelEdit() {
  editing.value = false
  form.password = ''
}

/** Guarda los cambios del perfil y recarga el contexto. */
async function saveProfile() {
  if (!user.value) return
  if (!form.name.trim()) { toast.error('El nombre no puede estar vacío'); return }
  saving.value = true
  try {
    // Perfil propio: endpoint dedicado sin capability (campos personales whitelisteados).
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
    }
    if (form.password.trim()) payload.password = form.password.trim()

    const { data } = await api.put('/users/my-account', payload)
    if (data?.success) {
      toast.success('Perfil actualizado')
      await meStore.loadContext()
      editing.value = false
      form.password = ''
    } else {
      toast.error(data?.message || 'No se pudo actualizar el perfil')
    }
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Error al actualizar el perfil')
  } finally {
    saving.value = false
  }
}

/** Cierra la sesión y vuelve al login. */
function doLogout() {
  authStore.logout() // limpia tokens, socket y feature stores
  router.replace('/login')
}
</script>

<style scoped>
.user-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; margin-bottom: 14px;
  background: var(--z-inset); border: 1px solid var(--z-border);
  border-radius: var(--z-r-md);
}
.user-avatar {
  width: 46px; height: 46px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 1rem; flex-shrink: 0;
}
.user-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.user-name { color: var(--z-text); font-size: 0.95rem; font-weight: 600; }
.user-email { color: var(--z-text-dim); font-size: 0.8rem; }
.edit-toggle { display: inline-flex; align-items: center; gap: 5px; }

.edit-form {
  margin-bottom: 16px; padding: 16px;
  background: var(--z-inset); border: 1px solid var(--z-border);
  border-radius: var(--z-r-md);
}
.form-row { display: flex; gap: 12px; }
.form-row .form-field { flex: 1; }
.form-field { margin-bottom: 14px; }
.form-field label { display: block; font-size: 0.8rem; font-weight: 500; color: var(--z-text-soft); margin-bottom: 6px; }
.hint-inline { color: var(--z-text-mute); font-weight: 400; font-size: 0.7rem; }
.form-input {
  width: 100%; background: var(--z-bg); border: 1px solid var(--z-border);
  border-radius: var(--z-r-sm); padding: 9px 11px; color: var(--z-text); font-size: 0.85rem; outline: none;
  transition: border-color var(--z-t-fast), box-shadow var(--z-t-fast);
}
.form-input::placeholder { color: var(--z-text-mute); }
.form-input:focus { border-color: var(--z-accent); box-shadow: 0 0 0 3px var(--z-accent-soft); }
.form-actions { display: flex; gap: 10px; margin-top: 6px; }

.action-btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  background: var(--z-accent); color: #fff; border: 1px solid var(--z-accent); border-radius: var(--z-r-sm);
  padding: 9px 16px; font-size: 0.85rem; font-weight: 600; cursor: pointer;
  box-shadow: var(--z-shadow-accent);
  transition: background var(--z-t-fast), border-color var(--z-t-fast);
}
.action-btn-primary:hover:not(:disabled) { background: var(--z-accent-strong); border-color: var(--z-accent-strong); }
.action-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.action-btn-danger {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 16px; border-radius: var(--z-r-sm); font-size: 0.85rem; font-weight: 600; cursor: pointer;
  border: 1px solid rgba(239, 68, 68, 0.35); background: transparent; color: var(--z-danger-text);
  transition: background var(--z-t-fast), border-color var(--z-t-fast), color var(--z-t-fast);
}
.action-btn-danger:hover { background: var(--z-danger); border-color: var(--z-danger); color: #fff; }

.confirm-msg { color: var(--z-text-soft); font-size: 0.9rem; margin: 0; line-height: 1.5; }
.modal-actions { display: flex; gap: 10px; margin-top: 18px; }
.modal-action-btn { flex: 1; padding: 11px; }
.action-btn-danger-solid {
  background: var(--z-danger); color: #fff; border: 1px solid var(--z-danger); border-radius: var(--z-r-sm);
  padding: 10px 18px; font-size: 0.875rem; font-weight: 600; cursor: pointer;
  transition: background var(--z-t-fast);
}
.action-btn-danger-solid:hover { background: #dc2626; }
.action-btn-ghost {
  background: transparent; border: 1px solid var(--z-border-strong); color: var(--z-text-soft);
  font-size: 0.875rem; font-weight: 600; cursor: pointer; padding: 10px 16px; border-radius: var(--z-r-sm);
  transition: background var(--z-t-fast), color var(--z-t-fast), border-color var(--z-t-fast);
}
.action-btn-ghost:hover { color: var(--z-text); background: rgba(148, 163, 184, 0.08); border-color: var(--z-text-dim); }
</style>
