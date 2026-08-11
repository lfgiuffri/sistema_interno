<template>
  <SettingSection
    title="Exportar datos"
    description="Descargá tus datos en formato JSON"
    :icon="downloadOutline"
  >
    <SettingRow
      label="Exportar todo"
      hint="Genera un JSON con tus datos y configuración."
    >
      <button class="action-btn-sm" :disabled="exporting" @click="doExport">
        <ion-icon :icon="downloadOutline" /> {{ exporting ? 'Generando…' : 'Descargar' }}
      </button>
    </SettingRow>
  </SettingSection>
</template>

<script setup lang="ts">
/** Sección de exportación de datos del usuario. */
import { ref } from 'vue'
import { IonIcon } from '@ionic/vue'
import { downloadOutline } from 'ionicons/icons'
import SettingSection from '@/components/settings/SettingSection.vue'
import SettingRow from '@/components/settings/SettingRow.vue'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'

const toast = useToast()
const exporting = ref(false)

/** Descarga el export del backend como un archivo JSON local. */
async function doExport() {
  exporting.value = true
  try {
    const { data } = await api.get('/settings/export')
    const blob = new Blob([JSON.stringify(data?.data ?? data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sistema-interno-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Datos exportados')
  } catch {
    toast.error('Error al exportar')
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.action-btn-sm {
  padding: 8px 15px; border-radius: var(--z-r-sm); font-size: 0.82rem; font-weight: 600; cursor: pointer;
  border: 1px solid var(--z-border-strong); background: transparent; color: var(--z-text-soft);
  transition: background var(--z-t-fast), color var(--z-t-fast), border-color var(--z-t-fast);
  display: inline-flex; align-items: center; gap: 6px;
}
.action-btn-sm:hover { background: rgba(148, 163, 184, 0.08); color: var(--z-text); border-color: var(--z-text-dim); }
.action-btn-sm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
