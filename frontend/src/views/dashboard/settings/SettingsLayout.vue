<template>
  <ion-page>
    <ion-content class="ion-padding">
      <div class="settings-shell">
        <!-- Header compacto integrado -->
        <header class="settings-header">
          <div class="settings-header-text">
            <h1 class="settings-title">Configuración</h1>
            <p class="settings-subtitle">Preferencias y ajustes de la app</p>
          </div>
          <SaveIndicator
            class="settings-save-indicator"
            :saving="settings.saving.value"
            :dirty="settings.dirty.value"
            :has-error="!!settings.lastError.value"
          />
        </header>

        <!-- Tabs pills (mobile / tablet) -->
        <nav class="settings-tabs" aria-label="Secciones de configuración">
          <button
            v-for="s in SETTINGS_SECTIONS"
            :key="s.id"
            type="button"
            class="settings-tab"
            :class="{ active: s.id === currentSectionId }"
            :data-section="s.id"
            @click="goTo(s.id)"
          >
            <ion-icon :icon="s.icon" />
            <span>{{ s.label }}</span>
          </button>
        </nav>

        <!-- Layout grid: sidebar + content -->
        <div class="settings-grid">
          <aside class="settings-sidebar" aria-label="Navegación de configuración">
            <button
              v-for="s in SETTINGS_SECTIONS"
              :key="s.id"
              type="button"
              class="sidebar-item"
              :class="{ active: s.id === currentSectionId }"
              :data-section="s.id"
              @click="goTo(s.id)"
            >
              <ion-icon :icon="s.icon" class="sidebar-icon" />
              <span class="sidebar-text">
                <span class="sidebar-label">{{ s.label }}</span>
                <span v-if="s.description" class="sidebar-description">{{ s.description }}</span>
              </span>
            </button>
          </aside>

          <main class="settings-content">
            <div :key="currentSection.id" class="settings-section-wrapper">
              <component :is="currentSection.component" />
            </div>

            <p class="app-footer">Sistema Interno v1.0.0</p>
          </main>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onUnmounted } from 'vue'
import { onIonViewWillEnter, IonPage, IonContent, IonIcon } from '@ionic/vue'
import { useRouter, useRoute } from 'vue-router'
import SaveIndicator from '@/components/settings/SaveIndicator.vue'
import { SETTINGS_SECTIONS, DEFAULT_SECTION_ID } from './sections'
import { useSettingsState } from './useSettingsState'

const router = useRouter()
const route = useRoute()
const settings = useSettingsState()

// Cargar las preferencias del usuario al entrar a la pantalla de settings.
onIonViewWillEnter(() => {
  void settings.load()
})

const currentSectionId = computed(() => {
  const requested = String(route.query.section ?? '')
  if (requested && SETTINGS_SECTIONS.some((s) => s.id === requested)) return requested
  return DEFAULT_SECTION_ID
})

const currentSection = computed(
  () => SETTINGS_SECTIONS.find((s) => s.id === currentSectionId.value) ?? SETTINGS_SECTIONS[0],
)

function goTo(id: string) {
  if (id === currentSectionId.value) return
  router.replace({ path: '/configuracion', query: { section: id } })
}

onUnmounted(() => {
  if (settings.dirty.value) void settings.flush()
})
</script>

<style scoped>
/* ------ Shell ------ */
.settings-shell {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  font-family: var(--z-font);
}

/* ------ Header ------ */
.settings-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--z-border);
}
.settings-header-text { min-width: 0; }
.settings-title {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--z-text);
  margin: 0;
  letter-spacing: -0.025em;
}
.settings-subtitle {
  font-size: 0.85rem;
  color: var(--z-text-dim);
  margin: 4px 0 0 0;
}
.settings-save-indicator { flex-shrink: 0; }

/* ------ Pill tabs (mobile / tablet) ------ */
.settings-tabs {
  display: none;
  gap: 6px;
  overflow-x: auto;
  scroll-behavior: smooth;
  scrollbar-width: none;
  margin: 0 -16px;
  padding: 0 16px 4px 16px;
}
.settings-tabs::-webkit-scrollbar { display: none; }
.settings-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--z-r-pill);
  border: 1px solid var(--z-border);
  background: var(--z-surface-2);
  color: var(--z-text-dim);
  font-size: 0.82rem;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--z-t-fast), background var(--z-t-fast), border-color var(--z-t-fast);
  font-family: inherit;
  flex-shrink: 0;
}
.settings-tab ion-icon { font-size: 1rem; }
.settings-tab:hover { color: var(--z-text-soft); background: var(--z-surface-3); }
.settings-tab.active {
  background: var(--z-accent-soft);
  border-color: var(--z-accent-ring);
  color: var(--z-text);
}

/* ------ Grid ------ */
.settings-grid {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 28px;
  align-items: start;
}

/* ------ Sidebar ------ */
.settings-sidebar {
  position: sticky;
  top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  scrollbar-width: thin;
}
.sidebar-item {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 11px 13px;
  border-radius: var(--z-r-sm);
  color: var(--z-text-dim);
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: color var(--z-t-fast), background var(--z-t-fast), border-color var(--z-t-fast);
  width: 100%;
  font-family: inherit;
  font-size: inherit;
}
.sidebar-item:hover { background: rgba(148, 163, 184, 0.06); color: var(--z-text-soft); }
.sidebar-item.active {
  background: var(--z-accent-soft);
  border-color: var(--z-accent-ring);
  color: var(--z-text);
}
.sidebar-icon {
  font-size: 1.1rem;
  margin-top: 2px;
  flex-shrink: 0;
  color: inherit;
}
.sidebar-item.active .sidebar-icon { color: var(--z-accent-text); }
.sidebar-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sidebar-label { font-size: 0.88rem; font-weight: 500; }
.sidebar-description {
  font-size: 0.72rem;
  color: var(--z-text-mute);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar-item.active .sidebar-description { color: var(--z-text-dim); }

/* ------ Content ------ */
.settings-content {
  min-width: 0;
  min-height: calc(100vh - 200px);
  display: flex;
  flex-direction: column;
}

.app-footer {
  margin-top: auto;
  padding-top: 24px;
  text-align: center;
  font-size: 0.72rem;
  color: #4b5563;
}

/* ------ Animations ------ */
.settings-section-wrapper { animation: section-fade 0.15s ease; }
@keyframes section-fade {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}

/* ------ Responsive ------ */
@media (max-width: 900px) {
  .settings-grid { grid-template-columns: 1fr; gap: 16px; }
  .settings-sidebar { display: none; }
  .settings-tabs { display: flex; }
  .settings-content { min-height: auto; }
}

@media (max-width: 600px) {
  .settings-shell { gap: 14px; }
  .settings-title { font-size: 1.2rem; }
  .settings-subtitle { font-size: 0.78rem; }
}
</style>
