<template>
  <SettingSection
    title="Notificaciones en este navegador"
    description="Avisos del sistema aunque tengas la pestaña cerrada"
    :icon="notificationsOutline"
  >
    <SettingRow
      v-if="estado === 'activas'"
      label="Activadas en este navegador"
      hint="Vas a recibir los avisos acá. Cada navegador se activa por separado."
    >
      <button class="btn-chico" :disabled="ocupado" @click="desactivarAcá">Desactivar</button>
    </SettingRow>

    <SettingRow
      v-else-if="estado === 'bloqueado'"
      label="Bloqueadas por el navegador"
      hint="Las rechazaste antes, así que la app ya no puede volver a preguntar. Tocá el candado a la izquierda de la dirección → Notificaciones → Permitir, y recargá."
      stacked
    />

    <SettingRow
      v-else-if="estado === 'no-soportado'"
      label="No disponible"
      hint="Este navegador no soporta notificaciones. Funciona en Chrome, Edge y Firefox."
      stacked
    />

    <SettingRow
      v-else
      label="Activar en este navegador"
      hint="El navegador te va a pedir permiso. Solo aplica a este dispositivo."
    >
      <button class="btn-chico btn-primario" :disabled="ocupado" @click="activarAcá">
        {{ ocupado ? 'Activando…' : 'Activar' }}
      </button>
    </SettingRow>

    <SettingRow label="Probar" hint="Envía una notificación de prueba a este dispositivo">
      <button class="btn-chico" :disabled="probando" @click="probar">
        {{ probando ? 'Enviando…' : 'Enviar prueba' }}
      </button>
    </SettingRow>
  </SettingSection>

  <SettingSection
    title="Preferencias"
    description="No molestar y horario silencioso"
    :icon="notificationsOutline"
  >
    <SettingRow label="Notificaciones push" hint="Recibí avisos en tu dispositivo">
      <SettingToggle
        :model-value="settings.local.value.pushEnabled"
        @update:model-value="settings.update({ pushEnabled: $event })"
      />
    </SettingRow>

    <SettingRow label="No molestar" hint="Silencia todas las notificaciones">
      <SettingToggle
        :model-value="settings.local.value.doNotDisturbEnabled"
        @update:model-value="settings.update({ doNotDisturbEnabled: $event })"
      />
    </SettingRow>

    <SettingRow label="Inicio horario silencioso">
      <SettingInput
        :model-value="settings.local.value.quietHoursStart"
        type="time"
        @update:model-value="settings.update({ quietHoursStart: String($event) })"
      />
    </SettingRow>

    <SettingRow label="Fin horario silencioso">
      <SettingInput
        :model-value="settings.local.value.quietHoursEnd"
        type="time"
        @update:model-value="settings.update({ quietHoursEnd: String($event) })"
      />
    </SettingRow>
  </SettingSection>
</template>

<script setup lang="ts">
/**
 * Preferencias de notificaciones + alta de ESTE navegador en Web Push.
 *
 * La activación es por dispositivo: el permiso y la suscripción los da el navegador, no la
 * cuenta. Por eso hay que activarlo en cada uno (la compu de la oficina, la de casa…).
 */
import { ref, onMounted } from 'vue'
import { notificationsOutline } from 'ionicons/icons'
import SettingSection from '@/components/settings/SettingSection.vue'
import SettingRow from '@/components/settings/SettingRow.vue'
import SettingToggle from '@/components/settings/SettingToggle.vue'
import SettingInput from '@/components/settings/SettingInput.vue'
import { useSettingsState } from '../useSettingsState'
import { useNotificacionesNavegador } from '@/composables/useNotificacionesNavegador'
import { useToast } from '@/composables/useToast'
import api, { apiErrorMessage } from '@/services/api'

const settings = useSettingsState()
const toast = useToast()
const { estado, ocupado, revisarEstado, activar, desactivar } = useNotificacionesNavegador()
const probando = ref(false)

onMounted(() => { void revisarEstado() })

async function activarAcá(): Promise<void> {
  const r = await activar()
  r.ok ? toast.success(r.mensaje) : toast.error(r.mensaje)
}

async function desactivarAcá(): Promise<void> {
  const r = await desactivar()
  toast.success(r.mensaje)
}

/** Pide al backend que mande una notificación de prueba a este usuario. */
async function probar(): Promise<void> {
  probando.value = true
  try {
    await api.post('/settings/test-notification')
    toast.success('Notificación enviada')
  } catch (e) {
    // El backend explica QUÉ falta (sin suscripción, suscripción vencida): se muestra tal cual.
    toast.error(apiErrorMessage(e))
  } finally {
    probando.value = false
  }
}
</script>

<style scoped>
.btn-chico {
  padding: 8px 15px; border-radius: var(--z-r-sm); font-size: 0.82rem; font-weight: 600;
  cursor: pointer; border: 1px solid var(--z-border-strong); background: transparent;
  color: var(--z-text-soft); white-space: nowrap;
  transition: background var(--z-t-fast), color var(--z-t-fast), border-color var(--z-t-fast);
}
.btn-chico:hover { background: rgba(148, 163, 184, 0.08); color: var(--z-text); }
.btn-chico:disabled { opacity: 0.55; cursor: default; }
.btn-primario {
  background: rgb(var(--s-accent)); border-color: rgb(var(--s-accent)); color: #fff;
}
.btn-primario:hover { background: rgb(var(--s-accent)); color: #fff; opacity: 0.92; }
</style>
