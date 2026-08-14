<script setup lang="ts">
/**
 * Indicador del refresco automático: cuánto hace que se actualizó, pausar/reanudar y
 * refrescar ahora. Va en el encabezado de las pantallas pensadas para dejar en un monitor
 * (panel, servidores, ficha de servidor).
 *
 * Recibe el objeto que devuelve `useAutoRefresh`; toda la lógica vive ahí.
 */
import { IonIcon } from '@ionic/vue'
import { refreshOutline } from 'ionicons/icons'
import type { AutoRefresh } from '@/composables/useAutoRefresh'

const props = defineProps<{ auto: AutoRefresh }>()

/** Verde latiendo = al día · gris = pausado · rojo = no se pudo actualizar. */
const colorPunto = (): string => {
  if (!props.auto.activo.value) return 'bg-ink-faint'
  return props.auto.fallos.value ? 'bg-danger' : 'bg-ok animate-pulse'
}
</script>

<template>
  <div
    class="flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-line bg-surface text-2xs"
    :title="auto.activo.value
      ? 'Se actualiza solo. Clic para pausar.'
      : 'Actualización automática pausada. Clic para reanudar.'"
  >
    <button
      class="flex items-center gap-1.5"
      :aria-label="auto.activo.value ? 'Pausar la actualización automática' : 'Reanudar la actualización automática'"
      @click="auto.alternar()"
    >
      <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="colorPunto()"></span>
      <span class="text-ink-faint tnum">
        {{ !auto.activo.value ? 'pausado' : (auto.fallos.value ? 'sin conexión' : auto.hace.value) }}
      </span>
    </button>
    <button
      class="grid place-items-center w-5 h-5 rounded text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
      title="Actualizar ahora" aria-label="Actualizar ahora"
      @click="auto.refrescarAhora()"
    >
      <IonIcon :icon="refreshOutline" class="text-[13px]" />
    </button>
  </div>
</template>
