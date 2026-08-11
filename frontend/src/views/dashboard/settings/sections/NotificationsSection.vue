<template>
  <SettingSection
    title="Notificaciones"
    description="Push, no molestar y horario silencioso"
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
/** Sección de preferencias de notificaciones. */
import { notificationsOutline } from 'ionicons/icons'
import SettingSection from '@/components/settings/SettingSection.vue'
import SettingRow from '@/components/settings/SettingRow.vue'
import SettingToggle from '@/components/settings/SettingToggle.vue'
import SettingInput from '@/components/settings/SettingInput.vue'
import { useSettingsState } from '../useSettingsState'

const settings = useSettingsState()
</script>
