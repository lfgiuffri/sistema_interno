<script setup lang="ts">
/**
 * Velocidad de un sitio: promedio de respuesta por día, mes o año, una línea por vista.
 *
 * De dónde salen los números: el detalle de chequeos se purga a los 30 días, así que el mes y
 * el año se leen del **resumen diario permanente** (`sitio_velocidad_dia`), que el scheduler
 * consolida antes de purgar. El día de HOY se calcula del detalle porque todavía no está
 * consolidado — por eso puede moverse durante la jornada.
 *
 * El promedio ignora los chequeos que no respondieron: un timeout no es latencia, es una
 * caída, y sumarlo haría que un día con tres caídas parezca un día lento.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { IonIcon } from '@ionic/vue'
import { closeOutline, trendingUpOutline, trendingDownOutline } from 'ionicons/icons'
import { useMantenimientoStore, type SitioWeb, type SerieVelocidad } from '@/stores/mantenimiento'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import GraficoLinea, { type Serie } from '@/components/dashboard/GraficoLinea.vue'

const props = defineProps<{ sitio: SitioWeb }>()
const emit = defineEmits<{ cerrar: [] }>()

const store = useMantenimientoStore()
const abierto = ref(true)
useEscapeToClose(abierto, () => emit('cerrar'))

const granularidad = ref<'dia' | 'mes' | 'anio'>('dia')
const datos = ref<SerieVelocidad | null>(null)
const cargando = ref(true)

const GRANOS: Array<{ v: 'dia' | 'mes' | 'anio'; label: string; ayuda: string }> = [
  { v: 'dia', label: 'Por día', ayuda: 'Últimos 30 días' },
  { v: 'mes', label: 'Por mes', ayuda: 'Últimos 24 meses' },
  { v: 'anio', label: 'Por año', ayuda: 'Todo el historial' },
]

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Etiqueta del eje X según la granularidad («2026-08-21» → «21/8», «2026-08» → «ago 26»). */
function etiqueta(periodo: string): string {
  if (granularidad.value === 'anio') return periodo
  const [a, m, d] = periodo.split('-')
  if (granularidad.value === 'mes') return `${MESES_CORTOS[Number(m) - 1]} ${a.slice(2)}`
  return `${Number(d)}/${Number(m)}`
}

const labels = computed(() => (datos.value?.periodos ?? []).map(etiqueta))

/**
 * Una serie por vista. Solo se grafican las vistas que tienen ALGÚN dato: una vista recién
 * creada agregaría una línea plana en cero y una entrada más en la leyenda por nada.
 */
const series = computed<Serie[]>(() =>
  (datos.value?.vistas ?? [])
    .filter(v => v.serie.some(p => p?.promedioMs != null))
    .map(v => ({
      label: v.nombre || v.ruta,
      // `NaN` y no 0: Chart.js corta la línea en el hueco en vez de bajarla al piso, que
      // leería como «el sitio respondió instantáneo ese día».
      data: v.serie.map(p => (p?.promedioMs == null ? NaN : p.promedioMs)),
    })),
)

/** Resumen por vista: último valor con datos y la variación contra el período anterior. */
const resumen = computed(() =>
  (datos.value?.vistas ?? []).map((v) => {
    const conDatos = v.serie
      .map((p, i) => ({ p, i }))
      .filter(x => x.p?.promedioMs != null)
    const ultimo = conDatos.at(-1)
    const previo = conDatos.at(-2)
    const actual = ultimo?.p?.promedioMs ?? null
    const antes = previo?.p?.promedioMs ?? null
    return {
      id: v.id,
      etiqueta: v.nombre || v.ruta,
      ruta: v.ruta,
      activo: v.activo,
      promedioMs: actual,
      muestras: ultimo?.p?.muestras ?? 0,
      disponibilidad: ultimo?.p?.disponibilidad ?? null,
      minMs: ultimo?.p?.minMs ?? null,
      maxMs: ultimo?.p?.maxMs ?? null,
      // Variación en %: positiva = se puso más lento.
      variacion: actual != null && antes ? Math.round(((actual - antes) / antes) * 100) : null,
    }
  }),
)

const hayDatos = computed(() => series.value.length > 0)

/** Milisegundos legibles: arriba del segundo se lee en segundos. */
function ms(v: number | null): string {
  if (v == null) return '—'
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`
}

async function cargar(): Promise<void> {
  cargando.value = true
  datos.value = await store.fetchVelocidad(props.sitio.id, granularidad.value)
  cargando.value = false
}

watch(granularidad, () => { void cargar() })
onMounted(() => { void cargar() })
</script>

<template>
  <div class="ds-modal-backdrop" @click.self="emit('cerrar')">
    <div class="ds-modal max-w-3xl">
      <header class="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-ink">Velocidad de {{ sitio.nombre }}</h2>
          <p class="text-xs text-ink-soft mt-0.5 font-mono truncate">{{ sitio.url }}</p>
        </div>
        <button class="row-action shrink-0" title="Cerrar" aria-label="Cerrar" @click="emit('cerrar')">
          <IonIcon :icon="closeOutline" class="text-[16px]" />
        </button>
      </header>

      <div class="px-5 py-4 max-h-[70vh] overflow-y-auto">
        <!-- `flex-wrap` para que los tres botones bajen de renglón en celular. -->
        <div class="flex flex-wrap items-center gap-1.5 mb-4">
          <button
            v-for="g in GRANOS" :key="g.v"
            class="grano-tab" :class="{ 'grano-activo': granularidad === g.v }"
            :title="g.ayuda"
            @click="granularidad = g.v"
          >{{ g.label }}</button>
          <span class="text-2xs text-ink-faint ml-auto">
            {{ GRANOS.find(g => g.v === granularidad)?.ayuda }}
          </span>
        </div>

        <div v-if="cargando" class="ds-skeleton h-56"></div>

        <template v-else-if="hayDatos">
          <GraficoLinea :series="series" :labels="labels" formato="ms" :alto="230" />

          <table class="ds-table mt-4">
            <thead>
              <tr>
                <th>Vista</th>
                <th>Promedio</th>
                <th>Variación</th>
                <th>Mín / máx</th>
                <th>Disponibilidad</th>
                <th>Muestras</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in resumen" :key="r.id" :class="{ 'opacity-55': !r.activo }">
                <td>
                  <span class="text-sm font-medium text-ink">{{ r.etiqueta }}</span>
                  <p v-if="r.etiqueta !== r.ruta" class="text-2xs text-ink-faint font-mono">{{ r.ruta }}</p>
                </td>
                <td class="tnum text-sm">{{ ms(r.promedioMs) }}</td>
                <td class="tnum text-xs">
                  <span
                    v-if="r.variacion !== null"
                    class="inline-flex items-center gap-1"
                    :class="r.variacion > 0 ? 'text-danger' : r.variacion < 0 ? 'text-ok' : 'text-ink-faint'"
                  >
                    <IonIcon :icon="r.variacion > 0 ? trendingUpOutline : trendingDownOutline" class="text-[13px]" />
                    {{ r.variacion > 0 ? '+' : '' }}{{ r.variacion }}%
                  </span>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td class="tnum text-2xs text-ink-soft">{{ ms(r.minMs) }} / {{ ms(r.maxMs) }}</td>
                <td class="tnum text-xs" :class="r.disponibilidad !== null && r.disponibilidad < 99 ? 'text-warn font-medium' : 'text-ink-soft'">
                  {{ r.disponibilidad === null ? '—' : `${r.disponibilidad}%` }}
                </td>
                <td class="tnum text-2xs text-ink-faint">{{ r.muestras }}</td>
              </tr>
            </tbody>
          </table>

          <p class="text-2xs text-ink-faint mt-3">
            El promedio no cuenta los chequeos que no respondieron: un timeout es una caída, no
            latencia. La variación compara contra el período anterior con datos.
            <template v-if="granularidad === 'dia'">El día de hoy es parcial y se mueve durante la jornada.</template>
          </p>
        </template>

        <div v-else class="py-12 text-center">
          <p class="text-sm font-medium text-ink">Todavía no hay datos de velocidad</p>
          <p class="text-xs text-ink-faint mt-1">
            Se llena solo: cada chequeo (uno cada 5 minutos) suma una muestra, y el resumen
            diario se consolida a la noche.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row-action {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px;
  color: rgb(var(--s-ink-faint));
  transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
.grano-tab {
  height: 30px; padding: 0 12px; border-radius: 8px; font-size: 13px; font-weight: 500;
  color: rgb(var(--s-ink-soft)); border: 1px solid rgb(var(--s-line));
  background: rgb(var(--s-surface));
  transition: background-color 0.12s ease, color 0.12s ease;
}
.grano-tab:hover { background: rgb(var(--s-surface-2)); }
.grano-activo {
  background: rgb(var(--s-accent-soft)); color: rgb(var(--s-accent-ink));
  border-color: rgb(var(--s-accent) / 0.3); font-weight: 600;
}
</style>
