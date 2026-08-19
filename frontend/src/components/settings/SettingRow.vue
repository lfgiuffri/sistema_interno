<template>
  <div class="setting-row" :class="{ stacked }">
    <div class="setting-row-text">
      <label v-if="label" :for="inputId" class="setting-label">{{ label }}</label>
      <p v-if="hint" class="setting-hint">{{ hint }}</p>
      <slot name="hint" />
    </div>
    <div class="setting-row-control">
      <slot :inputId="inputId" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue'

defineProps<{
  label?: string
  hint?: string
  /** Si true, label arriba y control debajo (ocupa todo el ancho). */
  stacked?: boolean
}>()

const inputId = useId ? useId() : `set-${Math.random().toString(36).slice(2)}`
</script>

<style scoped>
.setting-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 15px 0; gap: 20px; min-height: 46px;
}
.setting-row + .setting-row { border-top: 1px solid var(--z-border-faint); }
.setting-row.stacked { flex-direction: column; align-items: stretch; gap: 9px; }
.setting-row.stacked .setting-row-control { width: 100%; }
.setting-row-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.setting-label { font-size: 0.9rem; color: var(--z-text); font-weight: 500; }
.setting-hint { font-size: 0.78rem; color: var(--z-text-mute); margin: 0; line-height: 1.4; }
.setting-row-control { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* En un celular la fila en dos columnas no cierra: el control tiene `flex-shrink: 0` y el
   texto `min-width: 0`, así que todo lo que falta de ancho se lo come la etiqueta — a 320px
   quedaba con 0px y el título salía UNA LETRA POR RENGLÓN. Apilar es lo correcto: la etiqueta
   y su explicación se leen completas y el control usa todo el ancho. */
@media (max-width: 640px) {
  .setting-row { flex-direction: column; align-items: stretch; gap: 9px; }
  .setting-row-control { width: 100%; }
}
</style>
