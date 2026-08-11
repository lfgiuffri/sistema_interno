<template>
  <input
    :type="type"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    :placeholder="placeholder"
    :disabled="disabled"
    class="setting-input"
    :class="{ small }"
    @input="onInput"
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string | number | null
  type?: 'text' | 'number' | 'time' | 'email' | 'password'
  min?: number | string
  max?: number | string
  step?: number | string
  placeholder?: string
  disabled?: boolean
  small?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string | number): void }>()

function onInput(ev: Event) {
  const target = ev.target as HTMLInputElement
  if (props.type === 'number') {
    const n = target.value === '' ? 0 : Number(target.value)
    emit('update:modelValue', Number.isFinite(n) ? n : 0)
  } else {
    emit('update:modelValue', target.value)
  }
}
</script>

<style scoped>
.setting-input {
  background-color: var(--z-inset);
  border: 1px solid var(--z-border);
  border-radius: var(--z-r-sm);
  padding: 8px 11px;
  color: var(--z-text);
  font-size: 0.85rem;
  outline: none;
  transition: border-color var(--z-t-fast), box-shadow var(--z-t-fast);
  font-family: inherit;
}
.setting-input::placeholder { color: var(--z-text-mute); }
.setting-input:hover:not(:disabled):not(:focus) { border-color: var(--z-border-strong); }
.setting-input:focus { border-color: var(--z-accent); box-shadow: 0 0 0 3px var(--z-accent-soft); }
.setting-input:disabled { opacity: 0.5; cursor: not-allowed; }
.setting-input.small { max-width: 96px; text-align: right; font-variant-numeric: tabular-nums; }
</style>
