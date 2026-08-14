<script setup lang="ts">
/**
 * Ficha de un servidor: estado actual, evolución de CPU/RAM/disco y bitácora de incidentes.
 *
 * Dos ventanas de tiempo: el detalle fino (últimas horas, una muestra por minuto) y la
 * tendencia diaria (promedio y máximo por día), que sobrevive a la purga de los 30 días.
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import { arrowBackOutline, serverOutline, alertCircleOutline, checkmarkCircleOutline } from 'ionicons/icons'
import GraficoLinea, { type Serie } from '@/components/dashboard/GraficoLinea.vue'
import { useMantenimientoStore, type ServidorDetalle } from '@/stores/mantenimiento'
import { fechaHora, fecha as fmtFecha } from '@/composables/useFormato'

const store = useMantenimientoStore()
const route = useRoute()
const router = useRouter()

const id = Number(route.params.id)
const servidor = ref<ServidorDetalle | null>(null)
const cargando = ref(false)
const vista = ref<'fino' | 'diario'>('fino')

async function cargar(): Promise<void> {
  cargando.value = true
  servidor.value = await store.fetchServidor(id)
  cargando.value = false
}

/** Etiquetas del eje X según la vista elegida. */
const etiquetas = computed<string[]>(() => {
  if (!servidor.value) return []
  return vista.value === 'fino'
    ? servidor.value.serie.map(p => new Date(p.t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    : servidor.value.serieDiaria.map(p => fmtFecha(p.fecha))
})

const series = computed<Serie[]>(() => {
  if (!servidor.value) return []
  const fuente = vista.value === 'fino' ? servidor.value.serie : servidor.value.serieDiaria
  return [
    { label: 'CPU', data: fuente.map(p => p.cpu) },
    { label: 'RAM', data: fuente.map(p => p.ram) },
    { label: 'Disco', data: fuente.map(p => p.disco) },
  ]
})

const hayDatos = computed(() => (vista.value === 'fino' ? servidor.value?.serie.length : servidor.value?.serieDiaria.length))

/** Etiqueta legible de un tipo de incidente. */
const ETIQUETA_TIPO: Record<string, string> = {
  offline: 'Sin respuesta',
  cpu: 'CPU alta',
  ram: 'Memoria alta',
  disco: 'Disco casi lleno',
}

/** Duración de un incidente ya resuelto. */
function duracion(desde: string, hasta: string | null): string {
  const fin = hasta ? new Date(hasta).getTime() : Date.now()
  const min = Math.max(1, Math.round((fin - new Date(desde).getTime()) / 60000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void cargar() })
onIonViewWillEnter(() => { if (loadedOnce) void cargar() })
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

        <button class="flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink transition-colors mb-3" @click="router.push('/mantenimiento/servidores')">
          <IonIcon :icon="arrowBackOutline" class="text-[14px]" /> Servidores
        </button>

        <div v-if="cargando && !servidor" class="space-y-3">
          <div class="ds-skeleton h-20"></div>
          <div class="ds-skeleton h-64"></div>
        </div>

        <template v-if="servidor">
          <header class="flex flex-wrap items-start justify-between gap-3 pb-5">
            <div>
              <h1 class="text-xl font-semibold tracking-tight text-ink flex items-center gap-2">
                <span
                  class="w-2.5 h-2.5 rounded-full"
                  :class="servidor.estado === 'online' ? 'bg-ok' : servidor.estado === 'offline' ? 'bg-danger' : 'bg-ink-faint'"
                ></span>
                {{ servidor.nombre }}
              </h1>
              <p class="mt-0.5 text-sm text-ink-soft font-mono">
                {{ servidor.ip }}<span v-if="servidor.so"> · {{ servidor.so }}</span>
              </p>
            </div>
            <p class="text-2xs text-ink-faint tnum">
              Último contacto: {{ servidor.ultimoContactoAt ? fechaHora(servidor.ultimoContactoAt) : 'nunca' }}
            </p>
          </header>

          <!-- Métricas actuales -->
          <section class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div v-for="m in [
              { k: 'cpu', label: 'CPU', valor: servidor.ultima?.cpu, umbral: servidor.umbrales.cpu },
              { k: 'ram', label: 'Memoria', valor: servidor.ultima?.ram, umbral: servidor.umbrales.ram },
              { k: 'disco', label: 'Disco', valor: servidor.ultima?.disco, umbral: servidor.umbrales.disco },
            ]" :key="m.k" class="ds-card px-4 py-3">
              <p class="text-2xs uppercase tracking-wide text-ink-faint">{{ m.label }}</p>
              <p
                class="mt-1 text-lg font-semibold tnum"
                :class="m.valor !== undefined && Number(m.valor) >= m.umbral ? 'text-danger' : 'text-ink'"
              >
                {{ m.valor !== undefined ? `${Number(m.valor).toFixed(1)}%` : '—' }}
              </p>
              <p class="text-2xs text-ink-faint">alerta a partir de {{ m.umbral }}%</p>
            </div>
            <div class="ds-card px-4 py-3">
              <p class="text-2xs uppercase tracking-wide text-ink-faint">Monitoreo</p>
              <p class="mt-1 text-sm font-medium text-ink">{{ servidor.monitorea ? 'Con agente' : 'Solo disponibilidad' }}</p>
              <p class="text-2xs text-ink-faint">
                {{ servidor.monitorea ? 'reporta cada minuto' : `chequeo TCP al puerto ${servidor.puertoChequeo}` }}
              </p>
            </div>
          </section>

          <!-- Detalle de discos -->
          <section v-if="servidor.ultima?.discos?.length" class="ds-card p-4 mb-5">
            <h2 class="text-xs font-semibold text-ink mb-2">Discos</h2>
            <div class="space-y-2">
              <div v-for="d in servidor.ultima.discos" :key="d.montaje" class="flex items-center gap-3">
                <span class="font-mono text-2xs text-ink-soft w-32 truncate">{{ d.montaje }}</span>
                <div class="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="d.uso >= servidor.umbrales.disco ? 'bg-danger' : 'bg-accent'"
                    :style="{ width: `${Math.min(100, d.uso)}%` }"
                  ></div>
                </div>
                <span class="tnum text-xs text-ink w-12 text-right">{{ d.uso }}%</span>
                <span class="tnum text-2xs text-ink-faint w-24 text-right">{{ d.libreGb.toFixed(1) }} GB libres</span>
              </div>
            </div>
          </section>

          <!-- Evolución -->
          <section class="ds-card p-4 mb-5">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-xs font-semibold text-ink">Evolución</h2>
              <div class="flex gap-1">
                <button
                  v-for="v in [{ k: 'fino', label: 'Últimas horas' }, { k: 'diario', label: 'Por día' }]"
                  :key="v.k"
                  class="px-2.5 h-7 rounded-md text-xs transition-colors"
                  :class="vista === v.k ? 'bg-accent-soft text-accent-ink font-medium' : 'text-ink-soft hover:bg-surface-2'"
                  @click="vista = v.k as 'fino' | 'diario'"
                >
                  {{ v.label }}
                </button>
              </div>
            </div>
            <GraficoLinea v-if="hayDatos" :series="series" :labels="etiquetas" :alto="220" formato="porcentaje" />
            <p v-else class="text-xs text-ink-faint py-10 text-center">
              {{ vista === 'fino' ? 'Todavía no hay métricas: instalá el agente para empezar a medir.' : 'El resumen por día aparece a partir de mañana.' }}
            </p>
          </section>

          <!-- Incidentes -->
          <section>
            <h2 class="text-sm font-semibold text-ink mb-2">Incidentes</h2>
            <div v-if="servidor.incidentes.length" class="ds-card divide-y divide-line-soft">
              <div v-for="i in servidor.incidentes" :key="i.id" class="flex items-center gap-3 px-4 py-2.5">
                <IonIcon
                  :icon="i.resueltoAt ? checkmarkCircleOutline : alertCircleOutline"
                  class="text-[16px] shrink-0"
                  :class="i.resueltoAt ? 'text-ok' : 'text-danger'"
                />
                <div class="min-w-0 flex-1">
                  <p class="text-sm text-ink">
                    {{ ETIQUETA_TIPO[i.tipo] ?? i.tipo }}
                    <span v-if="i.valor" class="text-ink-soft tnum">— {{ i.valor }}% (umbral {{ i.umbral }}%)</span>
                  </p>
                  <p class="text-2xs text-ink-faint">
                    {{ fechaHora(i.createdAt) }} · duró {{ duracion(i.createdAt, i.resueltoAt) }}
                    <span v-if="i.detalle"> · {{ i.detalle }}</span>
                  </p>
                </div>
                <span :class="i.resueltoAt ? 'ds-badge-ok' : 'ds-badge-danger'">
                  {{ i.resueltoAt ? 'Resuelto' : 'Abierto' }}
                </span>
              </div>
            </div>
            <div v-else class="ds-card flex flex-col items-center py-10 text-center">
              <IonIcon :icon="serverOutline" class="text-[18px] text-ink-faint mb-2" />
              <p class="text-sm text-ink">Sin incidentes registrados</p>
            </div>
          </section>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
</style>
