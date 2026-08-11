<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal-content" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>{{ title }}</h3>
        <button class="modal-close" aria-label="Cerrar" @click="$emit('close')">
          <ion-icon :icon="closeOutline" />
        </button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue'
import { closeOutline } from 'ionicons/icons'

defineProps<{
  title: string
}>()

defineEmits<{
  close: []
}>()
</script>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(2, 6, 23, 0.6); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  animation: modal-fade 0.16s var(--z-ease);
}
.modal-content {
  background: var(--z-surface-2);
  border: 1px solid var(--z-border);
  border-radius: var(--z-r-lg);
  width: 100%; max-width: 440px; max-height: 90vh; overflow-y: auto;
  box-shadow: var(--z-shadow-lg);
  animation: modal-pop 0.2s var(--z-ease);
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px; border-bottom: 1px solid var(--z-border-faint);
}
.modal-header h3 { font-size: 1.02rem; font-weight: 600; color: var(--z-text); margin: 0; letter-spacing: -0.01em; }
.modal-close {
  width: 32px; height: 32px; border-radius: var(--z-r-sm); border: none;
  background: transparent; color: var(--z-text-dim); font-size: 1.2rem; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--z-t-fast), color var(--z-t-fast);
}
.modal-close:hover { background: rgba(148, 163, 184, 0.1); color: var(--z-text); }
.modal-body { padding: 20px 22px; }

@keyframes modal-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes modal-pop {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
</style>
