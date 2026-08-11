<script setup lang="ts">
/** Bandera de prioridad (SVG con currentColor, mismos colores que el legado). */
import { computed } from 'vue'
import { PRIORIDADES } from '@/stores/tareas'

const props = withDefaults(defineProps<{ prioridad: string; size?: number }>(), { size: 16 })
const meta = computed(() => PRIORIDADES[props.prioridad] ?? PRIORIDADES.verde)
</script>

<template>
  <span class="inline-flex" :title="`Prioridad: ${meta.label}`" :style="{ color: meta.color }">
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 3a1 1 0 0 1 1 1v.4c.6-.25 1.5-.4 2.8-.4 1.4 0 2.4.4 3.3.7.8.3 1.5.6 2.5.6 1.5 0 2.2-.3 2.6-.5l.8-.5V13l-.4.3c-.6.4-1.6.7-3 .7-1.3 0-2.3-.4-3.1-.7-.9-.3-1.7-.6-2.7-.6-1.5 0-2.2.3-2.8.5V21a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Z" />
    </svg>
  </span>
</template>
