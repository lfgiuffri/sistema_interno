<script setup lang="ts">
/**
 * Planificación de pagos: matriz empleado × cuenta del período (default: MES ANTERIOR —
 * los sueldos se abonan al mes siguiente). Disponible por cuenta, restante, semáforo de
 * "falta" y AUTOGUARDADO con estado visible (Guardando… / Guardado ✓ / error).
 */
import { ref, computed, onMounted } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import { chevronBackOutline, chevronForwardOutline, checkmarkCircleOutline, syncOutline, alertCircleOutline, downloadOutline } from 'ionicons/icons'
import { descargarCsv } from '@/composables/useCsv'
import { useSueldosStore, type Planificacion } from '@/stores/sueldos'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { moneda as fmtMoneda, MESES } from '@/composables/useFormato'

const sueldosStore = useSueldosStore()
const meStore = useMeStore()
const toast = useToast()

const hoyD = new Date()
const periodo = ref({
  anio: hoyD.getMonth() === 0 ? hoyD.getFullYear() - 1 : hoyD.getFullYear(),
  mes: hoyD.getMonth() === 0 ? 12 : hoyD.getMonth(),
})
const plan = ref<Planificacion | null>(null)
const loading = ref(false)

// Estado editable local: montos y pagos por clave `${empId}:${ctaId}`, disponibles por cuenta.
const montos = ref<Record<string, string>>({})
const pagos = ref<Record<string, boolean>>({})
const disponibles = ref<Record<number, string>>({})

const estadoGuardado = ref<'idle' | 'guardando' | 'ok' | 'error'>('idle')
let guardarTimer: ReturnType<typeof setTimeout> | null = null

const puedeEditar = computed(() => meStore.can('planificacion:manage'))
const k = (e: number, c: number) => `${e}:${c}`

async function load(): Promise<void> {
  loading.value = true
  const data = await sueldosStore.fetchPlanificacion(periodo.value.anio, periodo.value.mes)
  loading.value = false
  if (!data) { toast.error('No se pudo cargar la planificación'); return }
  plan.value = data
  periodo.value = { anio: data.anio, mes: data.mes }
  montos.value = {}
  pagos.value = {}
  for (const c of data.celdas) {
    montos.value[k(c.empleadoId, c.cuentaId)] = String(c.monto)
    pagos.value[k(c.empleadoId, c.cuentaId)] = c.pagado
  }
  disponibles.value = Object.fromEntries(data.disponibles.map(d => [d.cuentaId, String(d.monto)]))
  estadoGuardado.value = 'idle'
}

function cambiarMes(delta: number): void {
  let { anio, mes } = periodo.value
  mes += delta
  if (mes < 1) { mes = 12; anio -= 1 }
  if (mes > 12) { mes = 1; anio += 1 }
  periodo.value = { anio, mes }
  void load()
}

// ── Totales calculados en vivo ──
const num = (v: string | undefined) => Number(v) || 0
const totalColumna = (ctaId: number) =>
  (plan.value?.empleados ?? []).reduce((acc, e) => acc + num(montos.value[k(e.id, ctaId)]), 0)
const restante = (ctaId: number) => num(disponibles.value[ctaId]) - totalColumna(ctaId)
const asignadoFila = (empId: number) =>
  (plan.value?.cuentas ?? []).reduce((acc, c) => acc + num(montos.value[k(empId, c.id)]), 0)
const faltaFila = (empId: number) => {
  const emp = plan.value?.empleados.find(e => e.id === empId)
  return (emp?.sueldoDelMes ?? 0) - asignadoFila(empId)
}
const claseFalta = (falta: number) => (Math.abs(falta) < 1 ? 'text-ok' : falta > 0 ? 'text-warn' : 'text-danger')
const granTotal = computed(() => (plan.value?.empleados ?? []).reduce((acc, e) => acc + asignadoFila(e.id), 0))

// ── Autoguardado con coalescing (patrón del legado) ──
function programarGuardado(): void {
  if (!puedeEditar.value || !plan.value) return
  estadoGuardado.value = 'guardando'
  if (guardarTimer) clearTimeout(guardarTimer)
  guardarTimer = setTimeout(() => { void guardar() }, 600)
}

async function guardar(): Promise<void> {
  if (!plan.value) return
  const celdas = []
  for (const e of plan.value.empleados) {
    for (const c of plan.value.cuentas) {
      const clave = k(e.id, c.id)
      // Se mandan todas las celdas tocadas o con valor (monto 0 borra en el backend).
      if (montos.value[clave] !== undefined || pagos.value[clave]) {
        celdas.push({ empleadoId: e.id, cuentaId: c.id, monto: num(montos.value[clave]), pagado: !!pagos.value[clave] })
      }
    }
  }
  const disp = plan.value.cuentas.map(c => ({ cuentaId: c.id, monto: num(disponibles.value[c.id]) }))
  const r = await sueldosStore.savePlanificacion({ anio: periodo.value.anio, mes: periodo.value.mes, celdas, disponibles: disp })
  estadoGuardado.value = r.ok ? 'ok' : 'error'
  if (!r.ok) toast.error(r.message)
}

const mesQueSePaga = computed(() => {
  const m = periodo.value.mes === 12 ? 1 : periodo.value.mes + 1
  return MESES[m - 1]
})

/** Export CSV de la matriz del período (mejora §10.8). */
function exportarCsv(): void {
  if (!plan.value) return
  const cols = ['Empleado', 'Sueldo del mes', ...plan.value.cuentas.map(c => c.nombre), 'Asignado', 'Falta']
  const filas = plan.value.empleados.map(e => [
    e.nombre, e.sueldoDelMes,
    ...plan.value!.cuentas.map(c => num(montos.value[k(e.id, c.id)]) || ''),
    asignadoFila(e.id), faltaFila(e.id),
  ])
  descargarCsv(`planificacion-${periodo.value.anio}-${String(periodo.value.mes).padStart(2, '0')}`, cols, filas)
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
      <div class="max-w-[1400px] mx-auto px-5 lg:px-8 py-6 ds-enter">

        <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Planificación de pagos</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              Sueldos de {{ MESES[periodo.mes - 1] }} {{ periodo.anio }} — se abonan en {{ mesQueSePaga }}.
            </p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <!-- Estado de autoguardado -->
            <span v-if="estadoGuardado === 'guardando'" class="flex items-center gap-1 text-xs text-ink-faint">
              <IonIcon :icon="syncOutline" class="text-[13px] animate-spin" /> Guardando…
            </span>
            <span v-else-if="estadoGuardado === 'ok'" class="flex items-center gap-1 text-xs text-ok">
              <IonIcon :icon="checkmarkCircleOutline" class="text-[13px]" /> Guardado
            </span>
            <span v-else-if="estadoGuardado === 'error'" class="flex items-center gap-1 text-xs text-danger">
              <IonIcon :icon="alertCircleOutline" class="text-[13px]" /> No se pudo guardar
            </span>

            <button class="ds-btn-secondary h-8 w-8 !px-0" title="Exportar CSV" aria-label="Exportar CSV" @click="exportarCsv">
              <IonIcon :icon="downloadOutline" class="text-[14px]" />
            </button>
            <button class="ds-btn-secondary h-8 w-8 !px-0" aria-label="Mes anterior" @click="cambiarMes(-1)">
              <IonIcon :icon="chevronBackOutline" class="text-[15px]" />
            </button>
            <select v-model.number="periodo.mes" class="ds-input h-8 w-32" aria-label="Mes" @change="load()">
              <option v-for="(m, i) in MESES" :key="i" :value="i + 1">{{ m }}</option>
            </select>
            <select v-model.number="periodo.anio" class="ds-input h-8 w-24 font-mono" aria-label="Año" @change="load()">
              <option v-for="a in plan?.anios ?? [periodo.anio]" :key="a" :value="a">{{ a }}</option>
            </select>
            <button class="ds-btn-secondary h-8 w-8 !px-0" aria-label="Mes siguiente" @click="cambiarMes(1)">
              <IonIcon :icon="chevronForwardOutline" class="text-[15px]" />
            </button>
          </div>
        </header>

        <div v-if="loading && !plan" class="ds-skeleton h-64"></div>

        <template v-if="plan">
          <div v-if="!plan.empleados.length || !plan.cuentas.length" class="ds-card px-6 py-12 text-center">
            <p class="text-sm font-medium text-ink">
              {{ !plan.empleados.length ? 'No hay empleados activos.' : 'No hay cuentas de pago activas.' }}
            </p>
            <p class="text-xs text-ink-faint mt-1">
              {{ !plan.empleados.length ? 'Cargalos desde Empleados.' : 'Crealas desde Cuentas.' }}
            </p>
          </div>

          <div v-else class="ds-card overflow-x-auto">
            <table class="plan-table">
              <thead>
                <tr>
                  <th class="col-nombre text-left">Empleado</th>
                  <th>Sueldo del mes</th>
                  <th v-for="c in plan.cuentas" :key="c.id">{{ c.nombre }}</th>
                  <th>Asignado</th>
                  <th>Falta</th>
                </tr>
              </thead>
              <tbody>
                <!-- Disponible -->
                <tr class="fila-meta">
                  <td class="col-nombre text-2xs font-medium uppercase tracking-wide text-ink-faint">Disponible</td>
                  <td></td>
                  <td v-for="c in plan.cuentas" :key="c.id">
                    <input
                      v-model="disponibles[c.id]"
                      class="celda-input"
                      type="number" min="0" step="1"
                      :readonly="!puedeEditar"
                      :aria-label="`Disponible en ${c.nombre}`"
                      @input="programarGuardado"
                    />
                  </td>
                  <td colspan="2"></td>
                </tr>
                <!-- Restante -->
                <tr class="fila-meta">
                  <td class="col-nombre text-2xs font-medium uppercase tracking-wide text-ink-faint">Restante</td>
                  <td></td>
                  <td v-for="c in plan.cuentas" :key="c.id" class="tnum text-xs" :class="restante(c.id) < 0 ? 'text-danger font-medium' : 'text-ink-soft'">
                    {{ fmtMoneda(restante(c.id)) }}
                  </td>
                  <td colspan="2"></td>
                </tr>

                <!-- Empleados -->
                <tr v-for="e in plan.empleados" :key="e.id">
                  <td class="col-nombre font-medium text-ink text-[13px]">{{ e.nombre }}</td>
                  <td class="tnum text-ink-soft text-xs">{{ fmtMoneda(e.sueldoDelMes) }}</td>
                  <td v-for="c in plan.cuentas" :key="c.id" :class="{ 'celda-pagada': pagos[k(e.id, c.id)] }">
                    <div class="flex items-center gap-1">
                      <input
                        v-model="montos[k(e.id, c.id)]"
                        class="celda-input"
                        type="number" min="0" step="1"
                        :readonly="!puedeEditar"
                        :aria-label="`Monto de ${e.nombre} en ${c.nombre}`"
                        @input="programarGuardado"
                      />
                      <input
                        v-model="pagos[k(e.id, c.id)]"
                        type="checkbox"
                        class="accent-[#0F7660] shrink-0"
                        :disabled="!puedeEditar"
                        :title="pagos[k(e.id, c.id)] ? 'Pagado' : 'Marcar pagado'"
                        :aria-label="`Pagado: ${e.nombre} en ${c.nombre}`"
                        @change="programarGuardado"
                      />
                    </div>
                  </td>
                  <td class="tnum text-xs text-ink">{{ fmtMoneda(asignadoFila(e.id)) }}</td>
                  <td class="tnum text-xs font-medium" :class="claseFalta(faltaFila(e.id))">
                    {{ fmtMoneda(faltaFila(e.id)) }}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td class="col-nombre text-2xs font-medium uppercase tracking-wide text-ink-faint">Totales</td>
                  <td class="tnum text-xs text-ink-soft">{{ fmtMoneda(plan.empleados.reduce((a, e) => a + e.sueldoDelMes, 0)) }}</td>
                  <td v-for="c in plan.cuentas" :key="c.id" class="tnum text-xs font-medium text-ink">{{ fmtMoneda(totalColumna(c.id)) }}</td>
                  <td class="tnum text-xs font-semibold text-accent-ink">{{ fmtMoneda(granTotal) }}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p class="text-2xs text-ink-faint mt-2">
            Los cambios se guardan solos. Un monto en 0 borra la celda; la fecha de pago se fija al marcar «pagado» y se conserva.
          </p>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }

.plan-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.plan-table th {
  height: 36px; padding: 0 8px; text-align: center; white-space: nowrap;
  font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em;
  color: rgb(var(--s-ink-faint)); border-bottom: 1px solid rgb(var(--s-line));
  background: rgb(var(--s-surface-2) / 0.5);
}
.plan-table td {
  height: 42px; padding: 3px 6px; text-align: center;
  border-bottom: 1px solid rgb(var(--s-line-soft));
}
.plan-table tfoot td { border-bottom: none; border-top: 1px solid rgb(var(--s-line)); }
.col-nombre { min-width: 150px; text-align: left !important; padding-left: 12px !important; }
.fila-meta td { background: rgb(var(--s-surface-2) / 0.35); height: 36px; }

.celda-input {
  width: 96px; height: 28px; padding: 0 6px;
  border: 1px solid rgb(var(--s-line)); border-radius: 7px;
  background: rgb(var(--s-surface)); color: rgb(var(--s-ink));
  font-family: ui-monospace, monospace; font-size: 12px; text-align: right;
}
.celda-input:focus { outline: 2px solid rgb(var(--s-accent) / 0.4); outline-offset: 0; }
.celda-input[readonly] { background: transparent; border-color: transparent; }
.celda-pagada { background: rgb(var(--s-ok) / 0.08); }
</style>
