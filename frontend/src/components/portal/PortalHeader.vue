<script setup lang="ts">
/**
 * Barra superior del portal.
 *
 * Vive acá y no en el shell a propósito: en Ionic cada vista ruteada es su propio `IonPage`
 * con su `IonHeader` y su `IonContent`. Un header puesto en el shell, hermano del
 * `IonRouterOutlet`, queda por ENCIMA del contenido y se come los clics de lo que haya arriba
 * de la página (lo primero que tapó fue el botón de «Nueva incidencia»).
 */
import { useRouter } from 'vue-router'
import { IonHeader, IonIcon } from '@ionic/vue'
import { logOutOutline, moonOutline, sunnyOutline } from 'ionicons/icons'
import { usePortalAuthStore } from '@/stores/portal/auth'
import { usePortalIncidenciasStore } from '@/stores/portal/incidencias'
import { useTheme } from '@/composables/useTheme'

const router = useRouter()
const auth = usePortalAuthStore()
const incidencias = usePortalIncidenciasStore()
const { isDark, toggle } = useTheme()

function salir(): void {
  auth.logout()
  incidencias.reset()
  void router.replace('/portal/login')
}
</script>

<template>
  <IonHeader class="ion-no-border">
    <div class="portal-header border-b border-line">
      <div class="max-w-4xl mx-auto px-5 lg:px-8 h-14 flex items-center gap-3">
        <div class="w-7 h-8 grid place-items-center rounded bg-white shrink-0">
          <img src="/icons/logo.png" alt="" class="w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-ink truncate">{{ auth.usuario?.cliente?.nombre ?? 'Portal' }}</p>
          <p class="text-2xs text-ink-faint truncate">{{ auth.usuario?.nombre }}</p>
        </div>
        <button class="icon-btn" :title="isDark ? 'Tema claro' : 'Tema oscuro'" @click="toggle">
          <IonIcon :icon="isDark ? sunnyOutline : moonOutline" class="text-[16px]" />
        </button>
        <button class="icon-btn" title="Salir" aria-label="Salir" @click="salir">
          <IonIcon :icon="logOutOutline" class="text-[16px]" />
        </button>
      </div>
    </div>
  </IonHeader>
</template>

<style scoped>
.portal-header { background: rgb(var(--s-surface)); }
.icon-btn {
  display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.icon-btn:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
</style>
