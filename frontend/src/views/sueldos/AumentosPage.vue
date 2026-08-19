<script setup lang="ts">
/**
 * Aumentos programados multi-mes: % sobre un MES BASE (no se encadenan) o monto fijo.
 * Flujo de dos pasos con preview que muestra la matriz empleado × línea y AVISA qué
 * registros existentes se pisarían (mejora sobre el DELETE silencioso del legado).
 */
import { ref, computed, onMounted } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import { addOutline, trashOutline, warningOutline } from 'ionicons/icons'
import { useSueldosStore, type LineaAumento, type PreviewAumentos } from '@/stores/sueldos'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { moneda as fmtMoneda, fecha as fmtFecha, MESES } from '@/composables/useFormato'

const sueldosStore = useSueldosStore()
const meStore = useMeStore()
const toast = useToast()

const hoy = new Date()
const seleccion = ref<Set<number>>(new Set())
const base = ref({ anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 })
const lineas = ref<LineaAumento[]>([
  { anio: hoy.getMonth() === 11 ? hoy.getFullYear() + 1 : hoy.getFullYear(), mes: (hoy.getMonth() + 2 > 12 ? 1 : hoy.getMonth() + 2), tipo: 'pct', valor: '' },
])
const paso = ref<'form' | 'preview'>('form')
const preview = ref<PreviewAumentos | null>(null)
const formError = ref('')
const aplicando = ref(false)

const activos = computed(() => sueldosStore.rows.filter(r => r.activo))
const hayPct = computed(() => lineas.value.some(l => l.tipo === 'pct'))
const todosSeleccionados = computed(() =>
  activos.value.length > 0 && activos.value.every(r => seleccion.value.has(r.id))
)

function toggleEmpleado(id: number): void {
  const next = new Set(seleccion.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  seleccion.value = next
}
function toggleTodos(): void {
  seleccion.value = todosSeleccionados.value ? new Set() : new Set(activos.value.map(r => r.id))
}

function agregarLinea(): void {
  const ultima = lineas.value.at(-1)
  let anio = ultima?.anio ?? hoy.getFullYear()
  let mes = (ultima?.mes ?? hoy.getMonth() + 1) + 1
  if (mes > 12) { mes = 1; anio += 1 }
  lineas.value.push({ anio, mes, tipo: ultima?.tipo ?? 'pct', valor: '' })
}
function quitarLinea(i: number): void {
  lineas.value.splice(i, 1)
}

async function verPreview(): Promise<void> {
  formError.value = ''
  const r = await sueldosStore.previewAumentos({
    ids: [...seleccion.value], baseAnio: base.value.anio, baseMes: base.value.mes, lineas: lineas.value,
  })
  if (!r.ok) { formError.value = r.message; return }
  preview.value = r.data as PreviewAumentos
  paso.value = 'preview'
}

async function aplicar(): Promise<void> {
  if (aplicando.value) return
  aplicando.value = true
  const r = await sueldosStore.aplicarAumentos({
    ids: [...seleccion.value], baseAnio: base.value.anio, baseMes: base.value.mes, lineas: lineas.value,
  })
  aplicando.value = false
  if (!r.ok) { formError.value = r.message; paso.value = 'form'; return }
  const data = r.data as { empleados: number; meses: number }
  toast.success(`Aumentos programados para ${data.empleados} empleado(s) · ${data.meses} mes(es)`)
  paso.value = 'form'
  preview.value = null
  seleccion.value = new Set()
  lineas.value = [{ anio: hoy.getFullYear(), mes: hoy.getMonth() + 1, tipo: 'pct', valor: '' }]
  await sueldosStore.fetchAll()
}

let loadedOnce = false
onMounted(async () => {
  loadedOnce = true
  await sueldosStore.fetchAll()
  // Por defecto, TODOS los activos preseleccionados (regla del legado).
  seleccion.value = new Set(activos.value.map(r => r.id))
})
onIonViewWillEnter(() => { if (loadedOnce) void sueldosStore.fetchAll() })
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

        <header class="pb-5">
          <h1 class="text-xl font-semibold tracking-tight text-ink">Aumentos programados</h1>
          <p class="mt-0.5 text-sm text-ink-soft">
            Varios meses de una vez: % sobre el mes base (no se encadenan) o monto fijo. Reprogramar un mes reemplaza lo que hubiera.
          </p>
        </header>

        <template v-if="paso === 'form'">
          <!-- `min-w-0` en las dos columnas: sin eso el item de grid no baja del ancho de su
               contenido (nombres y montos van sin cortar) y la tarjeta se sale en el celular. -->
          <div class="grid lg:grid-cols-2 gap-5">
            <!-- Empleados -->
            <section class="ds-card min-w-0 p-4">
              <div class="flex items-center justify-between mb-2">
                <h2 class="text-sm font-semibold text-ink">Empleados</h2>
                <button class="ds-btn-ghost h-7 px-2 text-xs" @click="toggleTodos">
                  {{ todosSeleccionados ? 'Ninguno' : 'Todos' }}
                </button>
              </div>
              <div class="divide-y divide-line-soft max-h-72 overflow-y-auto">
                <label v-for="e in activos" :key="e.id" class="flex items-center gap-3 h-10 cursor-pointer">
                  <input type="checkbox" class="accent-[#0F7660]" :checked="seleccion.has(e.id)" @change="toggleEmpleado(e.id)" />
                  <span class="flex-1 text-sm text-ink truncate">{{ e.nombre }}</span>
                  <span class="tnum text-xs text-ink-soft">{{ fmtMoneda(e.vigente) }}</span>
                </label>
                <p v-if="!activos.length" class="text-xs text-ink-faint py-4 text-center">No hay empleados activos.</p>
              </div>
            </section>

            <!-- Líneas -->
            <section class="ds-card min-w-0 p-4">
              <h2 class="text-sm font-semibold text-ink mb-2">Aumentos</h2>

              <div v-if="hayPct" class="flex items-end gap-2 mb-3 pb-3 border-b border-line-soft">
                <div>
                  <label class="ds-label" for="au-bmes">Mes base (para los %)</label>
                  <select id="au-bmes" v-model.number="base.mes" class="ds-input h-8 w-36">
                    <option v-for="(m, i) in MESES" :key="i" :value="i + 1">{{ m }}</option>
                  </select>
                </div>
                <input v-model.number="base.anio" class="ds-input h-8 w-24 font-mono" type="number" min="2000" max="2100" aria-label="Año base" />
              </div>

              <div class="space-y-2">
                <!-- Cuatro controles en una fila no entran en un celular angosto: envuelven.
                     El valor lleva `min-w-[120px]` para que al bajar de renglón siga siendo usable. -->
                <div v-for="(l, i) in lineas" :key="i" class="flex flex-wrap items-center gap-2">
                  <select v-model.number="l.mes" class="ds-input h-8 w-32" :aria-label="`Mes de la línea ${i + 1}`">
                    <option v-for="(m, mi) in MESES" :key="mi" :value="mi + 1">{{ m }}</option>
                  </select>
                  <input v-model.number="l.anio" class="ds-input h-8 w-20 font-mono" type="number" min="2000" max="2100" :aria-label="`Año de la línea ${i + 1}`" />
                  <select v-model="l.tipo" class="ds-input h-8 w-24" :aria-label="`Tipo de la línea ${i + 1}`">
                    <option value="pct">%</option>
                    <option value="fijo">Fijo $</option>
                  </select>
                  <input v-model="l.valor" class="ds-input h-8 flex-1 min-w-[120px] font-mono text-right" type="text" inputmode="decimal" :placeholder="l.tipo === 'pct' ? 'Ej: 10' : 'Ej: 1500000'" :aria-label="`Valor de la línea ${i + 1}`" />
                  <button v-if="lineas.length > 1" class="row-action hover:!text-danger" title="Quitar línea" aria-label="Quitar línea" @click="quitarLinea(i)">
                    <IonIcon :icon="trashOutline" class="text-[14px]" />
                  </button>
                </div>
              </div>
              <button class="ds-btn-ghost h-7 px-2 text-xs mt-2" @click="agregarLinea">
                <IonIcon :icon="addOutline" class="text-[13px]" />
                Agregar mes
              </button>
            </section>
          </div>

          <p v-if="formError" class="ds-error mt-3" role="alert">{{ formError }}</p>

          <footer class="flex justify-end mt-4">
            <button
              class="ds-btn-primary"
              :disabled="!seleccion.size || !lineas.some(l => String(l.valor).trim())"
              @click="verPreview"
            >
              Ver preview
            </button>
          </footer>
        </template>

        <template v-else-if="preview">
          <!-- Aviso de pisados -->
          <div v-if="preview.pisados.length" class="flex gap-3 p-4 rounded-lg border border-warn/40 bg-warn/10 mb-4">
            <IonIcon :icon="warningOutline" class="text-[18px] text-warn shrink-0 mt-0.5" />
            <div class="text-sm">
              <p class="font-medium text-ink">Al confirmar se REEMPLAZAN {{ preview.pisados.length }} registro(s) existente(s) en esos meses:</p>
              <ul class="mt-1 text-xs text-ink-soft space-y-0.5">
                <li v-for="(p, i) in preview.pisados" :key="i" class="tnum">
                  {{ p.nombre }} · {{ fmtFecha(p.fecha) }} · {{ p.tipo }} → {{ fmtMoneda(p.sueldoNuevo) }}
                </li>
              </ul>
            </div>
          </div>

          <div class="ds-card overflow-x-auto mb-4">
            <table class="ds-table">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th v-if="hayPct">Base ({{ MESES[base.mes - 1] }} {{ base.anio }})</th>
                  <th v-for="(l, i) in preview.lineas" :key="i">{{ MESES[l.mes - 1] }} {{ l.anio }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in preview.filas" :key="f.empleadoId">
                  <td class="font-medium text-ink">{{ f.nombre }}</td>
                  <td v-if="hayPct" class="tnum text-ink-soft">{{ fmtMoneda(f.base) }}</td>
                  <td v-for="(v, i) in f.valores" :key="i" class="tnum text-ink">
                    {{ fmtMoneda(v.nuevo) }}
                    <span class="text-2xs text-ink-faint">{{ v.tipo === 'pct' ? `+${v.valor}%` : 'fijo' }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p v-if="formError" class="ds-error mb-2" role="alert">{{ formError }}</p>

          <footer class="flex justify-end gap-2">
            <button class="ds-btn-secondary" @click="paso = 'form'">Volver</button>
            <button v-if="meStore.can('aumentos:manage')" class="ds-btn-primary" :disabled="aplicando" @click="aplicar">
              {{ aplicando ? 'Aplicando…' : (preview.pisados.length ? 'Confirmar y reemplazar' : 'Confirmar aumentos') }}
            </button>
          </footer>
        </template>
      </div>
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
