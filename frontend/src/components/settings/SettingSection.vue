<template>
  <section class="settings-section" :class="{ 'no-card': !card }">
    <header v-if="title || $slots.header" class="section-header">
      <slot name="header">
        <div class="section-title-wrap">
          <ion-icon v-if="icon" :icon="icon" class="section-icon" />
          <h3 class="section-title">{{ title }}</h3>
        </div>
        <p v-if="description" class="section-description">{{ description }}</p>
      </slot>
    </header>
    <div class="section-body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="section-footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue'

withDefaults(
  defineProps<{
    title?: string
    description?: string
    icon?: string
    /** Si false, renderiza sin background card (útil para anidar). */
    card?: boolean
  }>(),
  { card: true },
)
</script>

<style scoped>
.settings-section {
  background: var(--z-surface-2);
  border: 1px solid var(--z-border);
  border-radius: var(--z-r-lg);
  padding: 22px 24px;
  margin-bottom: 16px;
}
.settings-section.no-card { background: transparent; border: none; padding: 0; margin-bottom: 0; }
.section-header { margin-bottom: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--z-border-faint); }
.settings-section.no-card .section-header { padding-bottom: 0; border-bottom: none; }
.section-title-wrap { display: flex; align-items: center; gap: 10px; }
.section-icon { font-size: 1.15rem; color: var(--z-accent-text); flex-shrink: 0; }
.section-title { font-size: 1.02rem; font-weight: 600; color: var(--z-text); margin: 0; letter-spacing: -0.01em; }
.section-description { font-size: 0.82rem; color: var(--z-text-mute); margin: 6px 0 0 0; line-height: 1.45; }
.section-body { display: flex; flex-direction: column; }
.section-footer { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--z-border-faint); }
</style>
