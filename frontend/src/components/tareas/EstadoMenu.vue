<script setup lang="ts">
/**
 * Badge de estado con menú desplegable para el cambio rápido (versión Ionic del
 * <details> con position:fixed del legado). Deshabilitado si no se puede editar.
 */
import { ref } from 'vue'
import { IonIcon } from '@ionic/vue'
import { checkmarkOutline, chevronDownOutline } from 'ionicons/icons'
import { ESTADOS_TAREA } from '@/stores/tareas'
import { useEscapeToClose } from '@/composables/useEscapeToClose'

const props = defineProps<{ estado: string; editable: boolean }>()
const emit = defineEmits<{ (e: 'cambiar', estado: string): void }>()

const abierto = ref(false)
useEscapeToClose(abierto, () => { abierto.value = false })

function elegir(estado: string): void {
  abierto.value = false
  if (estado !== props.estado) emit('cambiar', estado)
}
</script>

<template>
  <div class="relative inline-block">
    <button
      type="button"
      class="estado-badge"
      :style="{ '--c': ESTADOS_TAREA[estado]?.color ?? '#64748b' }"
      :disabled="!editable"
      :class="{ 'cursor-default': !editable }"
      @click="editable && (abierto = !abierto)"
    >
      <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: ESTADOS_TAREA[estado]?.color }"></span>
      {{ ESTADOS_TAREA[estado]?.label ?? estado }}
      <IonIcon v-if="editable" :icon="chevronDownOutline" class="text-[11px] opacity-60" />
    </button>

    <template v-if="abierto">
      <div class="fixed inset-0 z-30" @click="abierto = false"></div>
      <div class="estado-menu ds-enter" role="menu">
        <button
          v-for="(meta, key) in ESTADOS_TAREA"
          :key="key"
          type="button"
          class="estado-opcion"
          role="menuitem"
          @click="elegir(key as string)"
        >
          <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: meta.color }"></span>
          <span class="flex-1 text-left">{{ meta.label }}</span>
          <IonIcon v-if="key === estado" :icon="checkmarkOutline" class="text-[13px] text-accent" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.estado-badge {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 8px; border-radius: 999px;
  font-size: 11.5px; font-weight: 500;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 28%, transparent);
  white-space: nowrap;
}
.estado-menu {
  position: absolute; z-index: 40; top: calc(100% + 4px); left: 0;
  min-width: 160px; padding: 4px;
  background: rgb(var(--s-surface)); border: 1px solid rgb(var(--s-line));
  border-radius: 10px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
}
.estado-opcion {
  display: flex; align-items: center; gap: 8px; width: 100%;
  height: 30px; padding: 0 8px; border-radius: 7px; font-size: 13px;
  color: rgb(var(--s-ink));
}
.estado-opcion:hover { background: rgb(var(--s-surface-2)); }
</style>
