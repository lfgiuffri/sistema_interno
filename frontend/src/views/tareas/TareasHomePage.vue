<script setup lang="ts">
/**
 * Home del módulo Tareas: "Mis tareas" (4 tarjetas → resumen) + un tile por espacio
 * visible con pendientes/listas/vencidas (réplica de la home del legado).
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  onIonViewWillEnter, onIonViewWillLeave, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  albumsOutline, alertCircleOutline, todayOutline, hourglassOutline,
  checkmarkDoneOutline, lockClosedOutline, flagOutline,
} from 'ionicons/icons'
import { useTareasStore } from '@/stores/tareas'
import { useTareasEnVivo } from '@/composables/useTareasEnVivo'
import { useMeStore } from '@/stores/me'

const tareasStore = useTareasStore()
const meStore = useMeStore()
const router = useRouter()

const enVivo = useTareasEnVivo(() => tareasStore.fetchHome())

let loadedOnce = false
onMounted(() => { loadedOnce = true; void tareasStore.fetchHome(); enVivo.escuchar() })
onIonViewWillEnter(() => { if (loadedOnce) void tareasStore.fetchHome(); enVivo.escuchar() })
onIonViewWillLeave(() => enVivo.pausar())
</script>

<template>
  <IonPage>
    <IonHeader class="ion-no-border">
      <IonToolbar class="app-toolbar">
        <IonButtons slot="start" class="lg:hidden"><IonMenuButton /></IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent class="page-content">
      <div class="max-w-6xl mx-auto px-5 lg:px-8 py-6 ds-enter">

        <header class="flex items-center justify-between gap-4 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Tareas</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Tus pendientes y los espacios de trabajo a los que tenés acceso.</p>
          </div>
        </header>

        <div v-if="tareasStore.loading && !tareasStore.miResumen" class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div v-for="i in 4" :key="i" class="ds-skeleton h-20"></div>
        </div>

        <template v-if="tareasStore.miResumen">
          <!-- Mis tareas -->
          <section class="mb-6">
            <h2 class="text-sm font-semibold text-ink mb-2">Mis tareas</h2>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=pendientes')">
                <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                  <IonIcon :icon="checkmarkDoneOutline" class="text-[13px]" /> Pendientes
                </div>
                <p class="mt-1 text-lg font-semibold tnum text-ink">{{ tareasStore.miResumen.pendientes }}</p>
                <p class="text-2xs text-ink-faint">{{ tareasStore.miResumen.sinFecha }} sin fecha</p>
              </button>
              <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=hoy')">
                <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                  <IonIcon :icon="todayOutline" class="text-[13px]" /> Para hoy
                </div>
                <p class="mt-1 text-lg font-semibold tnum" :class="tareasStore.miResumen.hoy ? 'text-warn' : 'text-ink'">{{ tareasStore.miResumen.hoy }}</p>
                <p class="text-2xs text-ink-faint">vencen hoy</p>
              </button>
              <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=por_vencer')">
                <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                  <IonIcon :icon="hourglassOutline" class="text-[13px]" /> Por vencer
                </div>
                <p class="mt-1 text-lg font-semibold tnum" :class="tareasStore.miResumen.porVencer ? 'text-warn' : 'text-ink'">{{ tareasStore.miResumen.porVencer }}</p>
                <p class="text-2xs text-ink-faint">próximos {{ tareasStore.diasPorVencer }} días</p>
              </button>
              <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=vencidas')">
                <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                  <IonIcon :icon="alertCircleOutline" class="text-[13px]" /> Vencidas
                </div>
                <p class="mt-1 text-lg font-semibold tnum" :class="tareasStore.miResumen.vencidas ? 'text-danger' : 'text-ink'">{{ tareasStore.miResumen.vencidas }}</p>
                <p class="text-2xs text-ink-faint">pasó la fecha y siguen abiertas</p>
              </button>
            </div>
            <div v-if="tareasStore.miResumen.pendientes" class="flex flex-wrap gap-2 mt-2.5">
              <span v-if="tareasStore.miResumen.enProgreso" class="ds-badge-neutral">{{ tareasStore.miResumen.enProgreso }} en progreso</span>
              <span v-if="tareasStore.miResumen.pausadas" class="ds-badge-neutral">{{ tareasStore.miResumen.pausadas }} pausada(s)</span>
              <span v-if="tareasStore.miResumen.enRevision" class="ds-badge-neutral">{{ tareasStore.miResumen.enRevision }} en revisión</span>
              <span v-if="tareasStore.miResumen.urgentes" class="ds-badge-danger">
                <IonIcon :icon="flagOutline" class="text-[11px]" /> {{ tareasStore.miResumen.urgentes }} urgente(s)
              </span>
            </div>
          </section>

          <!-- Espacios -->
          <section>
            <h2 class="text-sm font-semibold text-ink mb-2">Espacios de trabajo</h2>

            <!-- `min-w-0` en cada tarjeta: un item de grid tiene `min-width: auto`, así que NO
                 baja del ancho de su contenido. Con un nombre largo (va con `truncate`, o sea
                 `nowrap`) el min-content es el texto entero: la tarjeta se sale de la pantalla
                 y arrastra a todas las de su columna. -->
            <div v-if="tareasStore.homeEspacios.length" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <button
                v-for="e in tareasStore.homeEspacios"
                :key="e.id"
                class="ds-card min-w-0 px-4 py-4 text-left hover:bg-surface-2/50 transition-colors group"
                @click="router.push(`/tareas/espacios/${e.id}`)"
              >
                <div class="flex items-center gap-2">
                  <div class="w-8 h-8 rounded-lg bg-accent-soft grid place-items-center shrink-0">
                    <IonIcon :icon="albumsOutline" class="text-[15px] text-accent-ink" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="font-medium text-ink truncate group-hover:text-accent transition-colors">{{ e.nombre }}</p>
                    <p class="text-2xs text-ink-faint">{{ e.listas }} lista(s)</p>
                  </div>
                  <IonIcon v-if="!e.editar" :icon="lockClosedOutline" class="text-[13px] text-ink-faint shrink-0" title="Solo lectura" />
                </div>
                <div class="flex items-center gap-3 mt-3">
                  <span class="text-lg font-semibold tnum text-ink">{{ e.pendientes }}</span>
                  <span class="text-xs text-ink-faint">pendiente(s)</span>
                  <span v-if="e.vencidas" class="ds-badge-danger ml-auto">{{ e.vencidas }} vencida(s)</span>
                </div>
              </button>
            </div>

            <div v-else class="ds-card px-6 py-12 text-center">
              <p class="text-sm font-medium text-ink">Todavía no tenés acceso a ningún espacio de trabajo.</p>
              <p class="text-xs text-ink-faint mt-1">Pedile a un administrador que te lo habilite desde <strong>Usuarios</strong>.</p>
            </div>
          </section>

          <p v-if="meStore.can('configuracion:update')" class="text-2xs text-ink-faint mt-4">
            Los días de aviso de «por vencer» se cambian en <button class="underline" @click="router.push('/configuracion')">Configuración</button>.
          </p>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
</style>
