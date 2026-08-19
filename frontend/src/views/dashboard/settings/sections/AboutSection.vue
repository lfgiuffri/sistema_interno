<template>
  <SettingSection
    title="Instalar la aplicación"
    description="Para abrirla desde el escritorio o la pantalla de inicio, sin pasar por el navegador"
    :icon="downloadOutline"
  >
    <SettingRow
      v-if="instalada"
      label="Ya está instalada"
      hint="Estás usando la app instalada, no la pestaña del navegador."
    >
      <span class="estado-ok"><ion-icon :icon="checkmarkCircleOutline" /> Instalada</span>
    </SettingRow>

    <SettingRow
      v-else-if="sePuedeInstalar"
      label="Instalar en este dispositivo"
      hint="Se abre en su propia ventana, con su ícono, y sigue funcionando igual."
    >
      <button class="action-btn-sm" :disabled="instalando" @click="instalarAhora">
        <ion-icon :icon="downloadOutline" /> {{ instalando ? 'Instalando…' : 'Instalar' }}
      </button>
    </SettingRow>

    <!-- Sin el evento del navegador no se puede abrir el diálogo por código: se explica
         cómo hacerlo a mano, que es la única alternativa honesta. -->
    <SettingRow v-else label="Instalar a mano" :hint="instruccionesManuales" stacked />
  </SettingSection>

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
/** Sección "Acerca de": instalación de la app, datos de versión y diagnóstico. */
import { IonIcon } from '@ionic/vue'
import { ref, computed } from 'vue'
import {
  informationCircleOutline, bugOutline, notificationsOutline,
  downloadOutline, checkmarkCircleOutline,
} from 'ionicons/icons'
import SettingSection from '@/components/settings/SettingSection.vue'
import SettingRow from '@/components/settings/SettingRow.vue'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'
import { useTheme } from '@/composables/useTheme'
import { useInstalarApp } from '@/composables/useInstalarApp'

const toast = useToast()
const { isDark } = useTheme()

const { instalada, sePuedeInstalar, esIOS, instalar } = useInstalarApp()
const instalando = ref(false)

/** Qué decirle al usuario cuando el navegador no nos deja abrir el diálogo. */
const instruccionesManuales = computed(() => {
  if (esIOS) return 'En iPhone o iPad: tocá Compartir y después «Agregar a inicio».'
  return 'Tu navegador no ofreció el diálogo en esta visita. En Chrome o Edge: menú (⋮) → '
    + '«Instalar Sistema Interno». En Firefox no está disponible.'
})

async function instalarAhora(): Promise<void> {
  instalando.value = true
  try {
    const r = await instalar()
    if (r === 'instalada') toast.success('Aplicación instalada')
    else if (r === 'rechazada') toast.info('Podés instalarla más tarde desde acá')
    else toast.error('El navegador no ofreció la instalación en esta visita')
  } finally {
    instalando.value = false
  }
}

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
.action-btn-sm:disabled { opacity: 0.55; cursor: default; }

.estado-ok {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 0.82rem; font-weight: 600; color: rgb(var(--s-ok));
}
</style>
