<script setup lang="ts">
/**
 * Campana de notificaciones del shell: badge con no leídas + panel desplegable.
 * El panel se TELEPORTA al body con posición fija calculada desde la campana:
 * dentro del menú lo recortaba el overflow del ion-menu.
 * Abrir el panel marca todo como leído (patrón centro de notificaciones simple).
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { IonIcon } from '@ionic/vue'
import {
  notificationsOutline, checkmarkDoneOutline, personOutline, timeOutline,
  chatbubbleOutline, walletOutline, flagOutline,
} from 'ionicons/icons'
import { useNotificacionesStore, type Notificacion } from '@/stores/notificaciones'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fechaHora } from '@/composables/useFormato'

const ICONO_POR_TIPO: Record<string, string> = {
  'tarea-asignada': personOutline,
  'tarea-estado': flagOutline,
  'tarea-comentario': chatbubbleOutline,
  'tarea-vencimiento': timeOutline,
  'abono-vencido': walletOutline,
}

const store = useNotificacionesStore()
const router = useRouter()
const abierto = ref(false)
const bellRef = ref<HTMLButtonElement | null>(null)
// Posición fija del panel (se calcula al abrir, anclada a la campana).
const panelPos = ref({ left: 0, bottom: 0 })
useEscapeToClose(abierto, () => { abierto.value = false })

async function toggle(): Promise<void> {
  if (!abierto.value && bellRef.value) {
    const rect = bellRef.value.getBoundingClientRect()
    const ancho = 320
    // Abre hacia arriba desde la campana; clamp para no salirse de la ventana.
    panelPos.value = {
      left: Math.min(Math.max(8, rect.left - 40), window.innerWidth - ancho - 8),
      bottom: window.innerHeight - rect.top + 8,
    }
  }
  abierto.value = !abierto.value
  if (abierto.value) {
    await store.fetchAll()
    // Abrir el panel = darse por enterado.
    if (store.noLeidas > 0) void store.marcarLeidas()
  }
}

function ir(n: Notificacion): void {
  abierto.value = false
  if (n.url) void router.push(n.url)
}

onMounted(() => {
  store.escuchar()
  void store.fetchAll()
})
</script>

<template>
  <button ref="bellRef" class="icon-btn relative" title="Notificaciones" aria-label="Notificaciones" @click="toggle">
    <IonIcon :icon="notificationsOutline" class="text-[16px]" />
    <span
      v-if="store.noLeidas"
      class="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-0.5 rounded-full bg-danger text-white text-[9px] font-semibold grid place-items-center tnum"
    >{{ store.noLeidas > 9 ? '9+' : store.noLeidas }}</span>
  </button>

  <!-- Panel al body: dentro del menú lo recorta el overflow del ion-menu. -->
  <Teleport to="body">
    <template v-if="abierto">
      <div class="fixed inset-0 z-[70]" @click="abierto = false"></div>
      <div
        class="panel ds-enter"
        role="dialog"
        aria-label="Notificaciones"
        :style="{ left: `${panelPos.left}px`, bottom: `${panelPos.bottom}px` }"
      >
        <header class="flex items-center justify-between px-3 h-10 border-b border-line-soft">
          <span class="text-sm font-semibold text-ink">Notificaciones</span>
          <IonIcon :icon="checkmarkDoneOutline" class="text-[14px] text-ink-faint" title="Se marcan leídas al abrir" />
        </header>
        <div class="max-h-[min(420px,60vh)] overflow-y-auto">
          <button
            v-for="n in store.rows"
            :key="n.id"
            class="notif"
            :class="{ 'notif-nueva': !n.leidaAt }"
            @click="ir(n)"
          >
            <IonIcon :icon="ICONO_POR_TIPO[n.tipo] ?? notificationsOutline" class="text-[15px] text-ink-faint shrink-0 mt-0.5" />
            <div class="min-w-0 flex-1 text-left">
              <p class="text-xs font-medium text-ink truncate">{{ n.titulo }}</p>
              <p v-if="n.cuerpo" class="text-2xs text-ink-soft truncate">{{ n.cuerpo }}</p>
              <p class="text-2xs text-ink-faint tnum mt-0.5">{{ fechaHora(n.createdAt) }}</p>
            </div>
          </button>
          <p v-if="!store.rows.length" class="px-3 py-8 text-center text-xs text-ink-faint">
            Sin notificaciones todavía.
          </p>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<style scoped>
.icon-btn {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.icon-btn:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
.panel {
  position: fixed; z-index: 71;
  width: 320px; background: rgb(var(--s-surface));
  border: 1px solid rgb(var(--s-line)); border-radius: 12px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.14); overflow: hidden;
}
.notif {
  display: flex; gap: 8px; width: 100%; padding: 8px 12px;
  border-bottom: 1px solid rgb(var(--s-line-soft));
  transition: background-color 0.12s ease;
}
.notif:hover { background: rgb(var(--s-surface-2)); }
.notif:last-child { border-bottom: none; }
.notif-nueva { background: rgb(var(--s-accent-soft) / 0.5); }
</style>
