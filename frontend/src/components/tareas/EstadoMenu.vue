<script setup lang="ts">
/**
 * Badge de estado con menú desplegable para el cambio rápido.
 *
 * El menú se dibuja con `position: fixed` y TELETRANSPORTADO fuera de la tabla (igual que
 * el `<details>` con position:fixed del legado): dentro del contenedor de la tabla, que
 * tiene `overflow-x: auto`, un menú `absolute` queda RECORTADO y no se ve. El destino es
 * `ion-app` para compartir contexto de apilado con los overlays de Ionic.
 */
import { ref, nextTick, onBeforeUnmount } from 'vue'
import { IonIcon } from '@ionic/vue'
import { checkmarkOutline, chevronDownOutline } from 'ionicons/icons'
import { ESTADOS_TAREA } from '@/stores/tareas'
import { useEscapeToClose } from '@/composables/useEscapeToClose'

const props = defineProps<{ estado: string; editable: boolean }>()
const emit = defineEmits<{ (e: 'cambiar', estado: string): void }>()

const abierto = ref(false)
const botonRef = ref<HTMLButtonElement | null>(null)
const coords = ref({ top: 0, left: 0 })

/** Alto y ancho aproximados del menú (5 estados) para decidir si abre hacia arriba. */
const ALTO_MENU = 168
const ANCHO_MENU = 160

useEscapeToClose(abierto, () => cerrar())

/** Cierra el menú y suelta los listeners de scroll/resize. */
function cerrar(): void {
  abierto.value = false
  window.removeEventListener('scroll', cerrar, true)
  window.removeEventListener('resize', cerrar)
}

/**
 * Abre el menú posicionándolo contra el badge. Si no entra abajo o a la derecha,
 * se voltea; al hacer scroll o redimensionar se cierra (las coordenadas quedarían viejas).
 */
async function abrir(): Promise<void> {
  if (!props.editable) return
  if (abierto.value) { cerrar(); return }

  abierto.value = true
  await nextTick()
  const r = botonRef.value?.getBoundingClientRect()
  if (!r) return
  const abajo = r.bottom + 4
  coords.value = {
    top: abajo + ALTO_MENU > window.innerHeight ? Math.max(8, r.top - ALTO_MENU - 4) : abajo,
    left: Math.min(r.left, window.innerWidth - ANCHO_MENU - 8),
  }
  window.addEventListener('scroll', cerrar, true)
  window.addEventListener('resize', cerrar)
}

function elegir(estado: string): void {
  cerrar()
  if (estado !== props.estado) emit('cambiar', estado)
}

onBeforeUnmount(cerrar)
</script>

<template>
  <div class="inline-block">
    <button
      ref="botonRef"
      type="button"
      class="estado-badge"
      :style="{ '--c': ESTADOS_TAREA[estado]?.color ?? '#64748b' }"
      :disabled="!editable"
      :class="{ 'cursor-default': !editable }"
      :aria-expanded="abierto"
      aria-haspopup="menu"
      @click="abrir()"
    >
      <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: ESTADOS_TAREA[estado]?.color }"></span>
      {{ ESTADOS_TAREA[estado]?.label ?? estado }}
      <IonIcon v-if="editable" :icon="chevronDownOutline" class="text-[11px] opacity-60" />
    </button>

    <Teleport defer to="ion-app">
      <template v-if="abierto">
        <div class="estado-backdrop" @click="cerrar()"></div>
        <div class="estado-menu ds-enter" role="menu" :style="{ top: `${coords.top}px`, left: `${coords.left}px` }">
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
    </Teleport>
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
.estado-backdrop { position: fixed; inset: 0; z-index: 55; }
.estado-menu {
  position: fixed; z-index: 56;
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
