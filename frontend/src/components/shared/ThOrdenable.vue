<script setup lang="ts">
/**
 * Encabezado de tabla que ordena al hacer clic.
 *
 * Es un `<th>` completo (no un wrapper) para no meter un elemento extra en la tabla, que
 * rompería el layout de columnas.
 */
import { computed } from 'vue'
import type { Direccion } from '@/composables/useOrdenTabla'

const props = defineProps<{
  /** Clave de la columna (la que recibe `ordenarPor`). */
  columna: string
  /** Columna por la que se está ordenando ahora. */
  activa: string
  dir: Direccion
}>()
const emit = defineEmits<{ (e: 'ordenar', columna: string): void }>()

const esActiva = computed(() => props.activa === props.columna)
</script>

<template>
  <th
    class="th-ordenable"
    :aria-sort="esActiva ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'"
    @click="emit('ordenar', columna)"
  >
    <span class="th-contenido">
      <slot />
      <!-- La flecha ocupa lugar siempre (invisible si no está activa): sin esto el
           encabezado se mueve al ordenar y la tabla "salta". -->
      <span class="th-flecha" :class="{ 'th-flecha-on': esActiva }">{{ esActiva && dir === 'desc' ? '↓' : '↑' }}</span>
    </span>
  </th>
</template>

<style scoped>
.th-ordenable { cursor: pointer; user-select: none; }
.th-ordenable:hover { color: rgb(var(--s-ink)); }
.th-contenido { display: inline-flex; align-items: center; gap: 3px; }
.th-flecha { opacity: 0; font-size: 0.9em; line-height: 1; transition: opacity 0.12s ease; }
.th-flecha-on { opacity: 1; }
.th-ordenable:hover .th-flecha { opacity: 0.45; }
.th-ordenable:hover .th-flecha-on { opacity: 1; }
</style>
