<template>
  <BaseSelect
    :model-value="modelValue"
    :options="options"
    :disabled="disabled"
    size="sm"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>

<script setup lang="ts">
/** Wrapper de settings sobre BaseSelect — mantiene la API previa (modelValue/options). */
import BaseSelect from '@/components/ui/BaseSelect.vue'

interface Option { value: string | number; label: string }

defineProps<{
  modelValue: string | number | null
  options: Array<Option | string>
  disabled?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string | number): void }>()
</script>
