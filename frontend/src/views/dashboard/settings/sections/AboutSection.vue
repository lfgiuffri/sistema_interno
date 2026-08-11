<template>
  <SettingSection
    title="Acerca de Sistema Interno"
    :icon="informationCircleOutline"
  >
    <div class="about-grid">
      <div class="about-row">
        <span class="about-label">Versión</span>
        <span class="about-value">v1.0.0</span>
      </div>
      <div class="about-row">
        <span class="about-label">Tema</span>
        <span class="about-value">{{ isDark ? 'Oscuro' : 'Claro' }}</span>
      </div>
      <div class="about-row">
        <span class="about-label">Idioma</span>
        <span class="about-value">Español (AR)</span>
      </div>
    </div>
  </SettingSection>

  <SettingSection
    title="Diagnóstico"
    description="Acciones útiles para resolver problemas"
    :icon="bugOutline"
  >
    <SettingRow label="Probar notificación" hint="Envía una notificación push de prueba">
      <button class="action-btn-sm" @click="testNotification">
        <ion-icon :icon="notificationsOutline" /> Probar
      </button>
    </SettingRow>
  </SettingSection>
</template>

<script setup lang="ts">
/** Sección "Acerca de" y diagnóstico básico. */
import { IonIcon } from '@ionic/vue'
import { informationCircleOutline, bugOutline, notificationsOutline } from 'ionicons/icons'
import SettingSection from '@/components/settings/SettingSection.vue'
import SettingRow from '@/components/settings/SettingRow.vue'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'
import { useTheme } from '@/composables/useTheme'

const toast = useToast()
const { isDark } = useTheme()

/** Pide al backend que envíe una notificación de prueba. */
async function testNotification() {
  try {
    await api.post('/settings/test-notification')
    toast.success('Notificación enviada')
  } catch {
    toast.error('Error al enviar notificación')
  }
}
</script>

<style scoped>
.about-grid { display: flex; flex-direction: column; gap: 0; }
.about-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--z-border-faint);
  font-size: 0.85rem;
}
.about-row:last-child { border-bottom: none; }
.about-label { color: var(--z-text-dim); }
.about-value { color: var(--z-text); font-weight: 500; }

.action-btn-sm {
  padding: 8px 15px; border-radius: var(--z-r-sm); font-size: 0.82rem; font-weight: 600; cursor: pointer;
  border: 1px solid var(--z-border-strong); background: transparent; color: var(--z-text-soft);
  transition: background var(--z-t-fast), color var(--z-t-fast), border-color var(--z-t-fast);
  display: inline-flex; align-items: center; gap: 6px;
}
.action-btn-sm:hover { background: rgba(148, 163, 184, 0.08); color: var(--z-text); border-color: var(--z-text-dim); }
</style>
