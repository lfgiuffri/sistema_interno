<template>
  <div class="z-empty">
    <div v-if="icon" class="z-empty-icon"><ion-icon :icon="icon" /></div>
    <p class="z-empty-msg"><slot>{{ message }}</slot></p>
    <slot name="action" />
  </div>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue'

defineProps<{
  message?: string
  icon?: string
}>()
</script>

<style scoped>
.z-empty {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  text-align: center; padding: 40px 24px;
}
.z-empty-icon {
  width: 52px; height: 52px; border-radius: var(--z-r-md);
  display: flex; align-items: center; justify-content: center;
  background: rgba(148, 163, 184, 0.08); color: var(--z-text-mute); font-size: 1.5rem;
}
.z-empty-msg { color: var(--z-text-dim); font-size: 0.9rem; margin: 0; max-width: 34ch; line-height: 1.5; }
</style>
