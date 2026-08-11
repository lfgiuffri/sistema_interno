<template>
  <div class="z-field" :class="{ block }">
    <input
      :id="id"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :min="min"
      :max="max"
      :step="step"
      :maxlength="maxlength"
      :inputmode="inputmode"
      :autocomplete="autocomplete"
      class="z-input"
      :class="{ small }"
      @input="onInput"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Input propio de Zero. Un solo estilo de campo (fondo hundido, focus ring del
 * acento) reutilizado en formularios y settings. Emite number si type=number.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | number | null
    type?: 'text' | 'number' | 'time' | 'email' | 'password' | 'search'
    placeholder?: string
    disabled?: boolean
    small?: boolean
    block?: boolean
    id?: string
    min?: number | string
    max?: number | string
    step?: number | string
    maxlength?: number
    inputmode?: 'text' | 'numeric' | 'email' | 'tel' | 'search'
    autocomplete?: string
  }>(),
  { type: 'text', block: true },
)
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
.z-field { display: inline-flex; }
.z-field.block { display: flex; width: 100%; }

.z-input {
  width: 100%;
  background: var(--z-inset);
  border: 1px solid var(--z-border);
  border-radius: var(--z-r-sm);
  padding: 10px 12px;
  color: var(--z-text);
  font-size: 0.875rem; font-family: inherit;
  outline: none;
  transition: border-color var(--z-t-fast), box-shadow var(--z-t-fast), background var(--z-t-fast);
}
.z-input::placeholder { color: var(--z-text-mute); }
.z-input:hover:not(:disabled):not(:focus) { border-color: var(--z-border-strong); }
.z-input:focus { border-color: var(--z-accent); box-shadow: 0 0 0 3px var(--z-accent-soft); }
.z-input:disabled { opacity: 0.5; cursor: not-allowed; }
.z-input.small { max-width: 96px; text-align: right; font-variant-numeric: tabular-nums; }
</style>
