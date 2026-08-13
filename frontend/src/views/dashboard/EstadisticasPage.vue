<script setup lang="ts">
/**
 * Estadísticas — gráficos anuales de FACTURACIÓN (antes vivían en el panel).
 *
 * Tres bloques con un único selector de año: mensual (abonos vs proyectos), abonos por
 * servicio (top 7 + "Otros") y facturación por área (con la tabla mes × área). Los tres
 * los calcula el backend en GET /dashboard/estadisticas y cada uno viaja null si el rol no
 * puede ver TODAS sus fuentes, así que la página muestra solo lo que corresponde.
 */
import { ref, computed, onMounted } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import { statsChartOutline } from 'ionicons/icons'
import GraficoLinea, { type Serie } from '@/components/dashboard/GraficoLinea.vue'
import api, { apiErrorMessage } from '@/services/api'
import { useToast } from '@/composables/useToast'
import { moneda as fmtMoneda, MESES } from '@/composables/useFormato'

interface SerieStats { label: string; slot?: string | null; total: number; data: number[] }
interface Estadisticas {
  anio: number
  anios: number[]
  mensual: { abonos: number[]; proyectos: number[]; totalAbonos: number; totalProyectos: number } | null
  servicios: SerieStats[] | null
  areas: SerieStats[] | null
}

const toast = useToast()

const data = ref<Estadisticas | null>(null)
const loading = ref(false)
const anio = ref(new Date().getFullYear())

// Series en el formato del componente de gráfico.
const serieMensual = computed<Serie[]>(() => {
  const m = data.value?.mensual
  if (!m) return []
  return [
    { label: 'Abonos', data: m.abonos },
    { label: 'Proyectos', data: m.proyectos },
  ]
})
const serieServicios = computed<Serie[]>(() => (data.value?.servicios ?? []) as Serie[])
const serieAreas = computed<Serie[]>(() => (data.value?.areas ?? []) as Serie[])

/** ¿El rol no habilita ningún gráfico? (los tres llegaron en null). */
const sinPermisos = computed(() =>
  !!data.value && !data.value.mensual && !data.value.servicios && !data.value.areas
)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await api.get('/dashboard/estadisticas', { params: { anio: anio.value } })
    if (res.data.success) {
      data.value = res.data.data
      anio.value = res.data.data.anio
    }
  } catch (e) {
    toast.error(apiErrorMessage(e))
  } finally {
    loading.value = false
  }
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void load() })
onIonViewWillEnter(() => { if (loadedOnce) void load() })
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

        <header class="flex flex-wrap items-center justify-between gap-3 pb-6">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink flex items-center gap-2">
              <IonIcon :icon="statsChartOutline" class="text-[18px] text-ink-faint" />
              Estadísticas
            </h1>
            <p class="mt-0.5 text-sm text-ink-soft">Facturación del año: abonos, proyectos, servicios y áreas.</p>
          </div>
          <select
            v-if="data?.anios?.length"
            v-model.number="anio"
            class="ds-input h-9 w-24 font-mono"
            aria-label="Año"
            @change="load()"
          >
            <option v-for="a in data.anios" :key="a" :value="a">{{ a }}</option>
          </select>
        </header>

        <!-- Cargando -->
        <div v-if="loading && !data" class="space-y-3">
          <div class="grid lg:grid-cols-2 gap-3">
            <div class="ds-skeleton h-64"></div>
            <div class="ds-skeleton h-64"></div>
          </div>
          <div class="ds-skeleton h-64"></div>
        </div>

        <template v-if="data">
          <div class="grid lg:grid-cols-2 gap-3 mb-3">
            <div v-if="data.mensual" class="ds-card p-4">
              <div class="flex items-baseline justify-between mb-2">
                <h2 class="text-xs font-semibold text-ink">Mensual: abonos vs proyectos</h2>
                <span class="text-2xs text-ink-faint tnum">{{ fmtMoneda(data.mensual.totalAbonos + data.mensual.totalProyectos) }}</span>
              </div>
              <p v-if="!data.mensual.totalAbonos && !data.mensual.totalProyectos" class="text-xs text-ink-faint py-8 text-center">
                Sin facturación registrada en {{ data.anio }}.
              </p>
              <GraficoLinea v-else :series="serieMensual" :alto="200" />
            </div>

            <div v-if="data.servicios" class="ds-card p-4">
              <h2 class="text-xs font-semibold text-ink mb-2">Abonos por servicio</h2>
              <p v-if="!serieServicios.length" class="text-xs text-ink-faint py-8 text-center">Sin facturación de abonos en {{ data.anio }}.</p>
              <GraficoLinea v-else :series="serieServicios" :alto="200" />
            </div>
          </div>

          <div v-if="data.areas" class="ds-card p-4">
            <h2 class="text-xs font-semibold text-ink mb-2">Facturación por área</h2>
            <p v-if="!serieAreas.length" class="text-xs text-ink-faint py-6 text-center">Sin movimientos en {{ data.anio }}.</p>
            <template v-else>
              <GraficoLinea :series="serieAreas" :alto="200" />
              <div class="overflow-x-auto mt-3 border-t border-line-soft pt-2">
                <table class="ds-table">
                  <thead>
                    <tr>
                      <th>Área</th>
                      <th v-for="(m, i) in MESES" :key="i">{{ m.slice(0, 3) }}</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="a in data.areas" :key="a.label">
                      <td class="text-sm text-ink">{{ a.label }}</td>
                      <td v-for="(v, i) in a.data" :key="i" class="tnum text-2xs" :class="v ? 'text-ink-soft' : 'text-ink-faint'">
                        {{ v ? `$${Math.round(v / 1000).toLocaleString('es-AR')}k` : '—' }}
                      </td>
                      <td class="tnum text-xs font-medium text-ink">{{ fmtMoneda(a.total) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="text-2xs text-ink-faint mt-2">El área sale del servicio: en los abonos, el del abono; en los proyectos, el del proyecto.</p>
            </template>
          </div>

          <!-- Sin permisos para ningún gráfico -->
          <div v-if="sinPermisos" class="ds-card px-6 py-10 text-center">
            <p class="text-sm font-medium text-ink">Los permisos de tu rol no alcanzan para ver estos gráficos.</p>
            <p class="text-xs text-ink-faint mt-1">Cada uno exige ver todas sus fuentes: facturaciones, cobranzas, servicios o áreas.</p>
          </div>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
</style>
