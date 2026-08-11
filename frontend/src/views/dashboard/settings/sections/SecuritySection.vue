<template>
  <SettingSection
    title="Seguridad"
    description="Verificación en dos pasos (2FA)"
    :icon="shieldCheckmarkOutline"
  >
    <!-- Estado inicial: UNA sola acción según el estado real del 2FA del usuario. -->
    <template v-if="!enrollment">
      <SettingRow
        v-if="mfaEnabled === null"
        label="Verificación en dos pasos"
        hint="Consultando el estado de tu segundo factor…"
      >
        <ion-spinner name="crescent" class="status-spinner" />
      </SettingRow>

      <SettingRow
        v-else-if="!mfaEnabled"
        label="Verificación en dos pasos"
        hint="Sumá un código de tu app autenticadora al iniciar sesión."
      >
        <button class="action-btn-primary" :disabled="mfa.loading" @click="startEnroll">
          <ion-icon :icon="lockClosedOutline" /> Activar 2FA
        </button>
      </SettingRow>

      <SettingRow
        v-else
        label="Verificación en dos pasos"
        hint="El segundo factor está activo. Vas a confirmar con tu contraseña para quitarlo."
      >
        <button class="action-btn-danger" @click="showDisable = true">
          <ion-icon :icon="closeCircleOutline" /> Desactivar 2FA
        </button>
      </SettingRow>
    </template>

    <!-- Flujo de enrolamiento: mostrar secreto + backup codes y pedir el código -->
    <template v-else>
      <div class="enroll-box">
        <p class="enroll-step">1. Agregá esta cuenta a tu autenticador</p>

        <!-- QR como texto del otpauth:// (no hay lib de QR; se muestra el string). -->
        <div class="otpauth-field">
          <span class="otpauth-label">Escaneá o pegá esta URI en tu app:</span>
          <code class="otpauth-url">{{ enrollment.otpauthUrl }}</code>
          <button class="copy-btn" @click="copy(enrollment.otpauthUrl, 'URI copiada')">
            <ion-icon :icon="copyOutline" /> Copiar URI
          </button>
        </div>

        <div class="secret-field">
          <span class="otpauth-label">O ingresá el código manualmente:</span>
          <code class="secret-code">{{ enrollment.secret }}</code>
          <button class="copy-btn" @click="copy(enrollment.secret, 'Código copiado')">
            <ion-icon :icon="copyOutline" /> Copiar código
          </button>
        </div>

        <div v-if="enrollment.backupCodes?.length" class="backup-box">
          <p class="enroll-step">2. Guardá tus códigos de respaldo</p>
          <p class="backup-hint">Cada código sirve una sola vez si perdés acceso a tu autenticador.</p>
          <div class="backup-grid">
            <code v-for="c in enrollment.backupCodes" :key="c" class="backup-code">{{ c }}</code>
          </div>
        </div>

        <div class="confirm-field">
          <p class="enroll-step">3. Confirmá con el código de 6 dígitos</p>
          <div class="code-row">
            <input
              v-model="code"
              type="text"
              inputmode="numeric"
              maxlength="6"
              placeholder="000000"
              class="code-input"
            />
            <button class="action-btn-primary" :disabled="mfa.loading || code.length < 6" @click="confirmActivate">
              <ion-icon :icon="checkmarkOutline" /> {{ mfa.loading ? 'Activando…' : 'Activar' }}
            </button>
          </div>
          <button class="action-btn-ghost cancel-enroll" @click="cancelEnroll">Cancelar</button>
        </div>
      </div>
    </template>
  </SettingSection>

  <!-- Modal de desactivación (pide contraseña) -->
  <AppModal v-if="showDisable" title="Desactivar 2FA" @close="closeDisable">
    <p class="confirm-msg">Ingresá tu contraseña para desactivar la verificación en dos pasos.</p>
    <input
      v-model="disablePassword"
      type="password"
      placeholder="Contraseña"
      autocomplete="current-password"
      class="modal-input"
    />
    <div class="modal-actions">
      <button
        class="action-btn-danger-solid modal-action-btn"
        :disabled="mfa.loading || !disablePassword"
        @click="confirmDisable"
      >
        Desactivar
      </button>
      <button class="action-btn-ghost" @click="closeDisable">Cancelar</button>
    </div>
  </AppModal>
</template>

<script setup lang="ts">
/**
 * Sección de seguridad: alta y baja del segundo factor (TOTP).
 *
 * El alta enrola (genera secreto + códigos de respaldo), muestra el `otpauthUrl`
 * como texto (no hay lib de QR disponible) y confirma con un código de 6 dígitos.
 * La baja pide la contraseña como confirmación.
 */
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { IonIcon, IonSpinner } from '@ionic/vue'
import {
  shieldCheckmarkOutline, lockClosedOutline, closeCircleOutline,
  checkmarkOutline, copyOutline,
} from 'ionicons/icons'
import SettingSection from '@/components/settings/SettingSection.vue'
import SettingRow from '@/components/settings/SettingRow.vue'
import AppModal from '@/components/shared/AppModal.vue'
import { useMfaStore } from '@/stores/mfa'
import { useToast } from '@/composables/useToast'

const mfa = useMfaStore()
const { enrollment, mfaEnabled } = storeToRefs(mfa)
const toast = useToast()

const code = ref('')
const showDisable = ref(false)
const disablePassword = ref('')

// Al montar la sección, consultar el estado real del 2FA para decidir qué acción mostrar.
// Se usa onMounted (no onIonViewWillEnter): esta sección se renderiza vía <component :is>
// dentro del layout, no como página del ion-router-outlet, así que el hook de Ionic no dispara.
onMounted(() => {
  void mfa.fetchStatus()
})

/** Inicia el enrolamiento de 2FA. */
async function startEnroll() {
  const res = await mfa.enroll()
  if (!res) toast.error('No pudimos iniciar el 2FA')
}

/** Cancela el enrolamiento en curso sin activar. */
function cancelEnroll() {
  mfa.reset()
  code.value = ''
}

/** Confirma la activación del 2FA con el código TOTP. */
async function confirmActivate() {
  const ok = await mfa.activate(code.value.trim())
  if (ok) {
    toast.success('2FA activado')
    code.value = ''
  } else {
    toast.error('Código incorrecto')
  }
}

/** Copia un texto al portapapeles y avisa por toast. */
async function copy(text: string, msg: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(msg)
  } catch {
    toast.error('No se pudo copiar')
  }
}

/** Cierra el modal de desactivación limpiando el campo. */
function closeDisable() {
  showDisable.value = false
  disablePassword.value = ''
}

/** Desactiva el 2FA tras confirmar la contraseña. */
async function confirmDisable() {
  const ok = await mfa.disable(disablePassword.value)
  toast[ok ? 'success' : 'error'](ok ? '2FA desactivado' : 'No se pudo desactivar (¿contraseña incorrecta?)')
  if (ok) closeDisable()
}
</script>

<style scoped>
.enroll-box { display: flex; flex-direction: column; gap: 14px; }
.enroll-step { font-size: 0.88rem; font-weight: 600; color: var(--z-text); margin: 0; }

.otpauth-field, .secret-field, .confirm-field {
  display: flex; flex-direction: column; gap: 9px;
  padding: 14px; border-radius: var(--z-r-md);
  background: var(--z-inset); border: 1px solid var(--z-border);
}
.otpauth-label { font-size: 0.75rem; color: var(--z-text-dim); }
.otpauth-url, .secret-code {
  display: block; word-break: break-all; font-family: var(--z-num);
  font-size: 0.78rem; color: var(--z-accent-text); background: var(--z-bg);
  padding: 9px 11px; border-radius: var(--z-r-sm); border: 1px solid var(--z-border-faint);
}
.secret-code { letter-spacing: 0.08em; color: var(--z-text); }

.copy-btn {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 11px; border-radius: var(--z-r-sm); font-size: 0.75rem; font-weight: 500; cursor: pointer;
  border: 1px solid var(--z-border-strong); background: transparent; color: var(--z-text-soft);
  transition: background var(--z-t-fast), color var(--z-t-fast);
}
.copy-btn:hover { background: rgba(148, 163, 184, 0.08); color: var(--z-text); }

.backup-box {
  padding: 14px; border-radius: var(--z-r-md);
  background: var(--z-inset); border: 1px solid var(--z-border);
}
.backup-hint { font-size: 0.74rem; color: var(--z-text-mute); margin: 5px 0 11px; }
.backup-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.backup-code {
  font-family: var(--z-num); font-size: 0.8rem; color: var(--z-text); text-align: center;
  background: var(--z-bg); padding: 7px 8px; border-radius: var(--z-r-sm); border: 1px solid var(--z-border-faint);
}

.code-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.code-input {
  flex: 1; min-width: 120px; background: var(--z-bg);
  border: 1px solid var(--z-border-strong); border-radius: var(--z-r-sm);
  padding: 10px 12px; color: var(--z-text); font-size: 1rem; letter-spacing: 0.28em; font-family: var(--z-num);
  text-align: center; outline: none; transition: border-color var(--z-t-fast), box-shadow var(--z-t-fast);
}
.code-input:focus { border-color: var(--z-accent); box-shadow: 0 0 0 3px var(--z-accent-soft); }
.cancel-enroll { align-self: flex-start; margin-top: 4px; }

.status-spinner { width: 20px; height: 20px; color: var(--z-accent); }

.action-btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  background: var(--z-accent); color: #fff; border: 1px solid var(--z-accent); border-radius: var(--z-r-sm);
  padding: 10px 18px; font-size: 0.85rem; font-weight: 600; cursor: pointer;
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

.confirm-msg { color: var(--z-text-soft); font-size: 0.9rem; margin: 0 0 14px; line-height: 1.5; }
.modal-input {
  width: 100%; background: var(--z-inset); border: 1px solid var(--z-border);
  border-radius: var(--z-r-sm); padding: 10px 12px; color: var(--z-text); font-size: 0.88rem; outline: none;
  transition: border-color var(--z-t-fast), box-shadow var(--z-t-fast);
}
.modal-input:focus { border-color: var(--z-accent); box-shadow: 0 0 0 3px var(--z-accent-soft); }
.modal-actions { display: flex; gap: 10px; margin-top: 18px; }
.modal-action-btn { flex: 1; padding: 11px; }
.action-btn-danger-solid {
  background: var(--z-danger); color: #fff; border: 1px solid var(--z-danger); border-radius: var(--z-r-sm);
  padding: 10px 18px; font-size: 0.875rem; font-weight: 600; cursor: pointer;
  transition: background var(--z-t-fast);
}
.action-btn-danger-solid:hover:not(:disabled) { background: #dc2626; }
.action-btn-danger-solid:disabled { opacity: 0.5; cursor: not-allowed; }
.action-btn-ghost {
  background: transparent; border: 1px solid var(--z-border-strong); color: var(--z-text-soft);
  font-size: 0.875rem; font-weight: 600; cursor: pointer; padding: 10px 16px; border-radius: var(--z-r-sm);
  transition: background var(--z-t-fast), color var(--z-t-fast), border-color var(--z-t-fast);
}
.action-btn-ghost:hover { color: var(--z-text); background: rgba(148, 163, 184, 0.08); border-color: var(--z-text-dim); }
</style>
