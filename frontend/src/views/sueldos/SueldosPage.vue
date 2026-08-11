<script setup lang="ts">
/**
 * Sueldos — listado con edición inline del monto, actualización por % (individual o
 * masiva con overrides por fila, dos pasos) y modal de historial (tipos del legado).
 * El vigente SIEMPRE sale del historial (fuente unificada).
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import { trendingUpOutline, timeOutline, cashOutline, downloadOutline } from 'ionicons/icons'
import { descargarCsv } from '@/composables/useCsv'
import { useSueldosStore, type SueldoRow, type HistorialSueldo } from '@/stores/sueldos'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { moneda as fmtMoneda, fecha as fmtFecha, porcentaje as fmtPct } from '@/composables/useFormato'

const sueldosStore = useSueldosStore()
const meStore = useMeStore()
const toast = useToast()
const route = useRoute()

// Edición inline: borradores por empleado.
const borradores = ref<Record<number, string>>({})

// Selección para actualización masiva (solo activos).
const seleccion = ref<Set<number>>(new Set())
const activos = computed(() => sueldosStore.rows.filter(r => r.activo))
const todosSeleccionados = computed(() =>
  activos.value.length > 0 && activos.value.every(r => seleccion.value.has(r.id))
)

// Modal actualizar por %
const modalPct = ref(false)
const paso = ref<'form' | 'preview'>('form')
const pctGlobal = ref('')
const overrides = ref<Record<number, string>>({})
const previewFilas = ref<Array<{ empleadoId: number; nombre: string; base: number; porcentaje: number; nuevo: number }>>([])
const pctError = ref('')
const aplicando = ref(false)
useEscapeToClose(modalPct, () => { modalPct.value = false })

// Modal historial
const modalHist = ref(false)
const historial = ref<HistorialSueldo | null>(null)
useEscapeToClose(modalHist, () => { modalHist.value = false })

async function load(): Promise<void> {
  await sueldosStore.fetchAll()
  borradores.value = Object.fromEntries(sueldosStore.rows.map(r => [r.id, String(r.vigente)]))
  const visibles = new Set(activos.value.map(r => r.id))
  seleccion.value = new Set([...seleccion.value].filter(id => visibles.has(id)))
}

/** Guarda el sueldo editado inline (solo si cambió). */
async function guardarInline(row: SueldoRow): Promise<void> {
  const nuevo = Number(borradores.value[row.id])
  if (!Number.isFinite(nuevo) || nuevo < 0 || nuevo === row.vigente) return
  const r = await sueldosStore.setSueldo(row.id, nuevo)
  if (!r.ok) { toast.error(r.message); borradores.value[row.id] = String(row.vigente); return }
  toast.success('Sueldo guardado')
  await load()
}

function toggleSeleccion(row: SueldoRow): void {
  if (!row.activo) return
  const next = new Set(seleccion.value)
  if (next.has(row.id)) next.delete(row.id)
  else next.add(row.id)
  seleccion.value = next
}

function toggleTodos(): void {
  seleccion.value = todosSeleccionados.value ? new Set() : new Set(activos.value.map(r => r.id))
}

function abrirActualizar(ids?: number[]): void {
  if (ids) seleccion.value = new Set(ids)
  paso.value = 'form'
  pctGlobal.value = ''
  overrides.value = {}
  pctError.value = ''
  modalPct.value = true
}

const seleccionados = computed(() => activos.value.filter(r => seleccion.value.has(r.id)))

async function verPreview(): Promise<void> {
  pctError.value = ''
  const r = await sueldosStore.previewActualizacion([...seleccion.value], pctGlobal.value, overrides.value)
  if (!r.ok) { pctError.value = r.message; return }
  previewFilas.value = r.data as typeof previewFilas.value
  paso.value = 'preview'
}

async function aplicar(): Promise<void> {
  if (aplicando.value) return
  aplicando.value = true
  const r = await sueldosStore.aplicarActualizacion([...seleccion.value], pctGlobal.value, overrides.value)
  aplicando.value = false
  if (!r.ok) { pctError.value = r.message; paso.value = 'form'; return }
  toast.success(`Se actualizaron ${(r.data as { actualizados: number }).actualizados} sueldo(s)`)
  modalPct.value = false
  seleccion.value = new Set()
  await load()
}

async function verHistorial(empleadoId: number): Promise<void> {
  const data = await sueldosStore.fetchHistorial(empleadoId)
  if (!data) { toast.error('Empleado no encontrado'); return }
  historial.value = data
  modalHist.value = true
}

/** Export CSV del listado (mejora §10.8). */
function exportarCsv(): void {
  descargarCsv('sueldos',
    ['Empleado', 'Categoría', 'Sueldo vigente', 'Último cambio', 'Aumentos futuros', 'Activo'],
    sueldosStore.rows.map(r => [r.nombre, r.categoria, r.vigente, r.ultCambio ?? '', r.futuros, r.activo ? 'Sí' : 'No']))
}

let loadedOnce = false
onMounted(async () => {
  loadedOnce = true
  await load()
  // Llegada desde la ficha con ?historial=<id>.
  const h = Number(route.query.historial)
  if (h > 0) void verHistorial(h)
})
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
      <div class="max-w-5xl mx-auto px-5 lg:px-8 py-6 ds-enter">

        <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Sueldos</h1>
            <p class="mt-0.5 text-sm text-ink-soft tnum">
              {{ sueldosStore.activos }} activo(s) · masa salarial {{ fmtMoneda(sueldosStore.masaSalarial) }}/mes
            </p>
          </div>
          <button class="ds-btn-secondary" title="Exportar CSV" @click="exportarCsv">
            <IonIcon :icon="downloadOutline" class="text-[15px]" />
            CSV
          </button>
        </header>

        <!-- Barra de selección -->
        <div v-if="seleccion.size > 0" class="flex items-center gap-3 mb-3 px-4 h-11 rounded-lg bg-accent-soft border border-accent/20 ds-enter">
          <span class="text-sm font-medium text-accent-ink tnum">{{ seleccion.size }} seleccionado(s)</span>
          <div class="flex-1"></div>
          <button v-if="meStore.can('sueldos:actualizar')" class="ds-btn-primary h-8" @click="abrirActualizar()">
            <IonIcon :icon="trendingUpOutline" class="text-[15px]" />
            Actualizar por %
          </button>
        </div>

        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th class="w-10">
                  <input type="checkbox" :checked="todosSeleccionados" class="accent-[#0F7660]" aria-label="Seleccionar todos" @change="toggleTodos" />
                </th>
                <th>Empleado</th>
                <th>Sueldo vigente</th>
                <th>Último cambio</th>
                <th>Estado</th>
                <th class="w-28"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="sueldosStore.loading && !sueldosStore.rows.length">
              <tr v-for="i in 4" :key="i"><td colspan="6" class="!px-3"><div class="ds-skeleton h-5 w-full my-2"></div></td></tr>
            </tbody>

            <tbody v-else-if="sueldosStore.rows.length">
              <tr v-for="row in sueldosStore.rows" :key="row.id" :class="{ 'opacity-50': !row.activo }">
                <td>
                  <input
                    type="checkbox" class="accent-[#0F7660]"
                    :checked="seleccion.has(row.id)" :disabled="!row.activo"
                    aria-label="Seleccionar empleado" @change="toggleSeleccion(row)"
                  />
                </td>
                <td>
                  <p class="font-medium text-ink">{{ row.nombre }}</p>
                  <p v-if="row.futuros" class="text-2xs text-warn">{{ row.futuros }} aumento(s) programado(s)</p>
                </td>
                <td>
                  <input
                    v-if="row.activo && meStore.can('sueldos:update')"
                    v-model="borradores[row.id]"
                    class="ds-input h-8 w-36 font-mono text-right"
                    type="number" min="0" step="1"
                    :aria-label="`Sueldo de ${row.nombre}`"
                    @keyup.enter="($event.target as HTMLInputElement).blur()"
                    @blur="guardarInline(row)"
                  />
                  <span v-else class="tnum text-ink">{{ fmtMoneda(row.vigente) }}</span>
                </td>
                <td class="tnum text-ink-soft">{{ row.ultCambio ? fmtFecha(row.ultCambio) : '—' }}</td>
                <td>
                  <span :class="row.activo ? 'ds-badge-ok' : 'ds-badge-neutral'">{{ row.activo ? 'Activo' : 'Inactivo' }}</span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <button
                      v-if="row.activo && meStore.can('sueldos:actualizar')"
                      class="row-action" title="Actualizar por %" aria-label="Actualizar por porcentaje"
                      @click="abrirActualizar([row.id])"
                    >
                      <IonIcon :icon="trendingUpOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('sueldos:historial')" class="row-action" title="Historial" aria-label="Historial" @click="verHistorial(row.id)">
                      <IonIcon :icon="timeOutline" class="text-[15px]" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>

            <tbody v-else>
              <tr>
                <td colspan="6" class="!h-auto">
                  <div class="flex flex-col items-center py-12 text-center">
                    <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
                      <IonIcon :icon="cashOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">No hay empleados</p>
                    <p class="text-xs text-ink-faint mt-1">Cargalos desde el módulo Empleados.</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Modal actualizar por % -->
      <Teleport to="body">
        <div v-if="modalPct" class="ds-modal-backdrop" @click.self="modalPct = false">
          <div class="ds-modal max-w-lg" role="dialog" aria-modal="true" aria-label="Actualizar sueldos por porcentaje">
            <h2 class="text-base font-semibold text-ink mb-1">Actualizar por porcentaje</h2>
            <p class="text-xs text-ink-soft mb-4">Sobre el sueldo vigente. Acepta decimales y negativos (baja).</p>

            <template v-if="paso === 'form'">
              <div class="mb-3">
                <label class="ds-label" for="pct-global">Porcentaje global</label>
                <input id="pct-global" v-model="pctGlobal" class="ds-input font-mono w-32" type="text" inputmode="decimal" placeholder="Ej: 12,5" />
              </div>
              <div class="border border-line rounded-lg divide-y divide-line-soft max-h-56 overflow-y-auto mb-3">
                <div v-for="e in seleccionados" :key="e.id" class="flex items-center gap-3 px-3 h-10">
                  <span class="flex-1 text-sm text-ink truncate">{{ e.nombre }}</span>
                  <span class="tnum text-xs text-ink-soft">{{ fmtMoneda(e.vigente) }}</span>
                  <input
                    v-model="overrides[e.id]"
                    class="ds-input h-7 w-20 font-mono text-right text-xs"
                    type="text" inputmode="decimal"
                    :placeholder="pctGlobal || '%'"
                    :aria-label="`Porcentaje para ${e.nombre}`"
                    title="Excepción por fila (vacío = usa el global)"
                  />
                </div>
              </div>
              <p v-if="pctError" class="ds-error mb-2" role="alert">{{ pctError }}</p>
              <footer class="flex justify-end gap-2">
                <button type="button" class="ds-btn-secondary" @click="modalPct = false">Cancelar</button>
                <button type="button" class="ds-btn-primary" :disabled="!pctGlobal.trim()" @click="verPreview">Ver preview</button>
              </footer>
            </template>

            <template v-else>
              <div class="border border-line rounded-lg overflow-hidden mb-3">
                <table class="ds-table">
                  <thead><tr><th>Empleado</th><th>Actual</th><th>%</th><th>Nuevo</th></tr></thead>
                  <tbody>
                    <tr v-for="f in previewFilas" :key="f.empleadoId">
                      <td class="text-sm text-ink">{{ f.nombre }}</td>
                      <td class="tnum text-ink-soft">{{ fmtMoneda(f.base) }}</td>
                      <td class="tnum" :class="f.porcentaje < 0 ? 'text-danger' : 'text-ok'">{{ f.porcentaje >= 0 ? '+' : '' }}{{ fmtPct(f.porcentaje) }}%</td>
                      <td class="tnum font-medium text-ink">{{ fmtMoneda(f.nuevo) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="pctError" class="ds-error mb-2" role="alert">{{ pctError }}</p>
              <footer class="flex justify-end gap-2">
                <button type="button" class="ds-btn-secondary" @click="paso = 'form'">Volver</button>
                <button type="button" class="ds-btn-primary" :disabled="aplicando" @click="aplicar">
                  {{ aplicando ? 'Aplicando…' : 'Confirmar actualización' }}
                </button>
              </footer>
            </template>
          </div>
        </div>
      </Teleport>

      <!-- Modal historial -->
      <Teleport to="body">
        <div v-if="modalHist && historial" class="ds-modal-backdrop" @click.self="modalHist = false">
          <div class="ds-modal max-w-xl" role="dialog" aria-modal="true" aria-label="Historial de sueldo">
            <h2 class="text-base font-semibold text-ink mb-1">Historial · {{ historial.empleado.nombre }}</h2>
            <p class="text-xs text-ink-soft mb-3 tnum">Vigente: {{ fmtMoneda(historial.vigente) }}</p>
            <div class="border border-line rounded-lg overflow-x-auto max-h-80 overflow-y-auto">
              <table class="ds-table">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Anterior</th><th>Nuevo</th><th>Variación</th><th>Usuario</th></tr></thead>
                <tbody>
                  <tr v-for="h in historial.historial" :key="h.id">
                    <td class="tnum text-ink-soft">{{ fmtFecha(h.fecha) }}</td>
                    <td><span class="ds-badge-neutral">{{ h.tipo }}</span></td>
                    <td class="tnum text-ink-soft">{{ fmtMoneda(h.anterior) }}</td>
                    <td class="tnum font-medium text-ink">{{ fmtMoneda(h.nuevo) }}</td>
                    <td class="tnum" :class="h.variacion === null ? 'text-ink-faint' : h.variacion < 0 ? 'text-danger' : 'text-ok'">
                      {{ h.variacion === null ? '—' : `${h.variacion >= 0 ? '+' : ''}${fmtPct(h.variacion)}%` }}
                    </td>
                    <td class="text-xs text-ink-soft">{{ h.usuario ?? '—' }}</td>
                  </tr>
                  <tr v-if="!historial.historial.length">
                    <td colspan="6" class="text-center text-ink-faint py-6">Sin registros todavía.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <footer class="flex justify-end pt-3">
              <button type="button" class="ds-btn-secondary" @click="modalHist = false">Cerrar</button>
            </footer>
          </div>
        </div>
      </Teleport>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
.row-action {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
</style>
