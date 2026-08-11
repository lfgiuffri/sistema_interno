<template>
  <Transition name="save-fade">
    <div v-if="visible" class="save-indicator" :class="state">
      <span v-if="state === 'saving'" class="spinner" aria-hidden="true" />
      <ion-icon v-else-if="state === 'saved'" :icon="checkmarkOutline" class="ico" />
      <ion-icon v-else :icon="alertCircleOutline" class="ico" />
      <span class="text">{{ label }}</span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IonIcon } from '@ionic/vue'
import { checkmarkOutline, alertCircleOutline } from 'ionicons/icons'

const props = defineProps<{
  saving: boolean
  dirty: boolean
  hasError?: boolean
}>()

const lastSavedAt = ref<number | null>(null)
const showSaved = ref(false)

watch(() => props.saving, (v, old) => {
  if (old && !v && !props.hasError && !props.dirty) {
    lastSavedAt.value = Date.now()
    showSaved.value = true
    setTimeout(() => { showSaved.value = false }, 1800)
  }
})

const state = computed<'saving' | 'saved' | 'error' | 'idle'>(() => {
  if (props.hasError) return 'error'
  if (props.saving) return 'saving'
  if (showSaved.value) return 'saved'
  return 'idle'
})

const visible = computed(() => state.value !== 'idle')

const label = computed(() => {
  if (state.value === 'saving') return 'Guardando…'
  if (state.value === 'saved') return 'Guardado'
  if (state.value === 'error') return 'Error al guardar'
  return ''
})
</script>

<style scoped>
.save-indicator {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 0.75rem; color: #94a3b8;
  padding: 4px 10px; border-radius: 999px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
}
.save-indicator.saved { color: #10b981; border-color: rgba(16,185,129,0.25); }
.save-indicator.error { color: #f87171; border-color: rgba(248,113,113,0.3); }
.ico { font-size: 0.85rem; }
.spinner {
  width: 10px; height: 10px; border-radius: 50%;
  border: 1.5px solid rgba(148,163,184,0.3); border-top-color: #94a3b8;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.save-fade-enter-active, .save-fade-leave-active { transition: opacity 0.2s ease; }
.save-fade-enter-from, .save-fade-leave-to { opacity: 0; }
</style>
