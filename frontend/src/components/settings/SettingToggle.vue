<template>
  <label class="toggle">
    <input type="checkbox" :checked="modelValue" @change="onChange" :disabled="disabled" />
    <span class="toggle-slider"></span>
  </label>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
function onChange(ev: Event) {
  emit('update:modelValue', (ev.target as HTMLInputElement).checked)
}
</script>

<style scoped>
.toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; cursor: pointer; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; inset: 0; background: rgba(148, 163, 184, 0.2);
  border-radius: var(--z-r-pill); transition: background var(--z-t);
}
.toggle-slider::before {
  content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px;
  background: #fff; border-radius: 50%;
  box-shadow: var(--z-shadow-sm);
  transition: transform var(--z-t);
}
.toggle input:checked + .toggle-slider { background: var(--z-accent); }
.toggle input:checked + .toggle-slider::before { transform: translateX(20px); }
.toggle input:focus-visible + .toggle-slider { box-shadow: 0 0 0 3px var(--z-accent-soft); }
.toggle input:disabled + .toggle-slider { opacity: 0.5; cursor: not-allowed; }
</style>
