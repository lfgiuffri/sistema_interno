<script setup lang="ts">
/**
 * Cobranzas de UN proyecto: KPIs (presupuesto/planificado/cobrado/faltantes),
 * cuotas en USD con tope, cobrar con peso REAL (cotización derivada, montos
 * congelados), mover/editar/eliminar solo pendientes y la bitácora de auditoría.
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  chevronBackOutline, addOutline, swapHorizontalOutline, trashOutline,
  checkmarkCircleOutline, arrowUndoOutline, createOutline, timeOutline,
} from 'ionicons/icons'
import { useProyectosStore, ESTADOS_PROYECTO, type CobranzasDetalle, type Cuota } from '@/stores/proyectos'
import CotizacionDolar from '@/components/shared/CotizacionDolar.vue'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { moneda as fmtMoneda, fecha as fmtFecha, MESES } from '@/composables/useFormato'

const route = useRoute()
const router = useRouter()
const store = useProyectosStore()
const meStore = useMeStore()
const toast = useToast()

const proyectoId = computed(() => Number(route.params.id) || 0)
const data = ref<CobranzasDetalle | null>(null)
const loading = ref(false)

// Selección múltiple: SOLO cuotas pendientes (las cobradas no se mueven).
const seleccion = ref<Set<number>>(new Set())
const pendientes = computed(() => data.value?.cuotas.filter(c => !c.cobrado) ?? [])

const hoy = new Date()
const modalAgregar = ref(false)
const modalMover = ref(false)
const formCuota = ref({ anio: hoy.getFullYear(), mes: hoy.getMonth() + 1, montoUsd: '' })
const formMover = ref({ anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 })
const modalError = ref('')
useEscapeToClose(modalAgregar, () => { modalAgregar.value = false })
useEscapeToClose(modalMover, () => { modalMover.value = false })

const EVENTO_LABEL: Record<string, string> = {
  creada: 'Creada', monto_editado: 'Monto editado', movida: 'Movida',
  cobrada: 'Cobrada', descobrada: 'Descobrada', eliminada: 'Eliminada',
}

async function load(): Promise<void> {
  loading.value = true
  const res = await store.fetchCobranzas(proyectoId.value)
  loading.value = false
  if (!res) { toast.error('Proyecto no encontrado'); router.replace('/proyectos'); return }
  data.value = res
  const vivos = new Set(res.cuotas.filter(c => !c.cobrado).map(c => c.id))
  seleccion.value = new Set([...seleccion.value].filter(id => vivos.has(id)))
}

function toggleSeleccion(c: Cuota): void {
  if (c.cobrado) return
  const next = new Set(seleccion.value)
  if (next.has(c.id)) next.delete(c.id)
  else next.add(c.id)
  seleccion.value = next
}

async function agregarCuota(): Promise<void> {
  modalError.value = ''
  const r = await store.addCuota(proyectoId.value, {
    anio: formCuota.value.anio, mes: formCuota.value.mes, montoUsd: Number(formCuota.value.montoUsd),
  })
  if (!r.ok) { modalError.value = r.message; return }
  toast.success('Cuota agregada')
  modalAgregar.value = false
  formCuota.value.montoUsd = ''
  await load()
}

async function moverSeleccion(): Promise<void> {
  modalError.value = ''
  const r = await store.moverCuotas(proyectoId.value, [...seleccion.value], formMover.value.anio, formMover.value.mes)
  if (!r.ok) { modalError.value = r.message; return }
  toast.success('Cuotas movidas')
  modalMover.value = false
  seleccion.value = new Set()
  await load()
}

/** Cobrar: se ingresa el PESO REAL recibido; la cotización queda derivada (pesos/USD). */
async function cobrar(c: Cuota): Promise<void> {
  const alert = await alertController.create({
    header: 'Cobrar cuota',
    message: `${MESES[c.mes - 1]} ${c.anio} · US$ ${Number(c.montoUsd)}. Ingresá el monto REAL recibido en pesos: la cotización queda derivada y congelada.`,
    inputs: [{ name: 'pesos', type: 'number', placeholder: 'Monto en pesos', value: String(Math.round(c.enPesos)) }],
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Cobrar',
        handler: async (input: { pesos?: string }) => {
          const pesos = Number(input.pesos)
          if (!pesos || pesos <= 0) { toast.error('Ingresá un monto en pesos mayor a 0'); return false }
          const r = await store.cobrar(proyectoId.value, c.id, pesos)
          if (!r.ok) { toast.error(r.message); return false }
          toast.success('Cuota cobrada')
          await load()
          return true
        },
      },
    ],
  })
  await alert.present()
}

async function descobrar(c: Cuota): Promise<void> {
  const alert = await alertController.create({
    header: 'Descobrar cuota',
    message: `Vuelve a pendiente y libera el monto congelado (${fmtMoneda(c.montoPesos ?? 0)}). El cobro queda registrado en la auditoría.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Descobrar', role: 'destructive',
        handler: async () => {
          const r = await store.descobrar(proyectoId.value, c.id)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Cuota descobrada')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

async function editarMonto(c: Cuota): Promise<void> {
  const alert = await alertController.create({
    header: 'Editar monto',
    message: 'Nuevo monto planificado, en dólares. Respeta el tope del presupuesto.',
    inputs: [{ name: 'usd', type: 'number', value: String(Number(c.montoUsd)), placeholder: 'Monto en USD' }],
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Guardar',
        handler: async (input: { usd?: string }) => {
          const usd = Number(input.usd)
          if (!usd || usd <= 0) { toast.error('Ingresá un monto en USD mayor a 0'); return false }
          const r = await store.editarMonto(proyectoId.value, c.id, usd)
          if (!r.ok) { toast.error(r.message); return false }
          toast.success('Monto actualizado')
          await load()
          return true
        },
      },
    ],
  })
  await alert.present()
}

async function eliminarCuota(c: Cuota): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar cuota',
    message: `¿Eliminar la cuota de ${MESES[c.mes - 1]} ${c.anio} (US$ ${Number(c.montoUsd)})? Queda registrado en la auditoría.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await store.eliminarCuota(proyectoId.value, c.id)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Cuota eliminada')
          await load()
        },
      },
    ],
  })
  await alert.present()
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

        <button class="ds-btn-ghost h-8 -ml-2 mb-3" @click="router.back()">
          <IonIcon :icon="chevronBackOutline" class="text-[14px]" />
          Proyectos
        </button>

        <div v-if="loading && !data" class="space-y-3">
          <div class="ds-skeleton h-8 w-72"></div>
          <div class="grid grid-cols-2 lg:grid-cols-5 gap-3"><div v-for="i in 5" :key="i" class="ds-skeleton h-20"></div></div>
        </div>

        <template v-if="data">
          <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
            <div>
              <h1 class="text-xl font-semibold tracking-tight text-ink">Cobranzas · {{ data.proyecto.nombre }}</h1>
              <p class="mt-0.5 text-sm text-ink-soft flex items-center gap-2">
                {{ data.proyecto.cliente?.nombre }}
                <span :class="ESTADOS_PROYECTO[data.proyecto.estado]?.badge ?? 'ds-badge-neutral'">
                  {{ ESTADOS_PROYECTO[data.proyecto.estado]?.label ?? data.proyecto.estado }}
                </span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <!-- La cotización se edita acá mismo: es el número con el que se convierte cada
                   cuota pendiente a pesos, y acá es donde se ve si quedó vieja. -->
              <CotizacionDolar :valor="data.kpis.cotizacion" @actualizada="load()" />
              <button v-if="meStore.can('cobranzas:create')" class="ds-btn-primary shrink-0" @click="modalError = ''; modalAgregar = true">
                <IonIcon :icon="addOutline" class="text-[16px]" />
                Agregar cuota
              </button>
            </div>
          </header>

          <!-- KPIs -->
          <section class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
            <div class="ds-card px-4 py-3">
              <p class="text-2xs uppercase tracking-wide text-ink-faint">Presupuesto</p>
              <p class="mt-1 text-lg font-semibold tnum text-ink">US$ {{ data.kpis.presupuestoUsd.toLocaleString('es-AR') }}</p>
              <p v-if="data.proyecto.moneda === 'ARS'" class="text-2xs text-ink-faint tnum">{{ fmtMoneda(data.proyecto.total) }} @ {{ data.kpis.cotizacion }}</p>
            </div>
            <div class="ds-card px-4 py-3">
              <p class="text-2xs uppercase tracking-wide text-ink-faint">Planificado</p>
              <p class="mt-1 text-lg font-semibold tnum text-ink">US$ {{ data.kpis.planUsd.toLocaleString('es-AR') }}</p>
            </div>
            <div class="ds-card px-4 py-3">
              <p class="text-2xs uppercase tracking-wide text-ink-faint">Cobrado</p>
              <p class="mt-1 text-lg font-semibold tnum text-ok">US$ {{ data.kpis.cobradoUsd.toLocaleString('es-AR') }}</p>
              <p class="text-2xs text-ink-faint tnum">{{ fmtMoneda(data.kpis.cobradoPesos) }}</p>
            </div>
            <div class="ds-card px-4 py-3">
              <p class="text-2xs uppercase tracking-wide text-ink-faint">Falta planificar</p>
              <p class="mt-1 text-lg font-semibold tnum" :class="data.kpis.faltaPlanificar > 0 ? 'text-warn' : 'text-ink'">
                US$ {{ data.kpis.faltaPlanificar.toLocaleString('es-AR') }}
              </p>
              <p v-if="!data.kpis.presupuestoUsd" class="text-2xs text-ink-faint">sin tope</p>
            </div>
            <div class="ds-card px-4 py-3">
              <p class="text-2xs uppercase tracking-wide text-ink-faint">Falta cobrar</p>
              <p class="mt-1 text-lg font-semibold tnum" :class="data.kpis.faltaCobrar > 0 ? 'text-warn' : 'text-ink'">
                US$ {{ data.kpis.faltaCobrar.toLocaleString('es-AR') }}
              </p>
            </div>
          </section>

          <!-- Barra de selección múltiple (mover) -->
          <div v-if="seleccion.size > 0" class="flex items-center gap-3 mb-3 px-4 h-11 rounded-lg bg-accent-soft border border-accent/20 ds-enter">
            <span class="text-sm font-medium text-accent-ink tnum">{{ seleccion.size }} cuota(s) pendiente(s)</span>
            <div class="flex-1"></div>
            <button v-if="meStore.can('cobranzas:mover')" class="ds-btn-secondary h-8" @click="modalError = ''; modalMover = true">
              <IonIcon :icon="swapHorizontalOutline" class="text-[15px]" />
              Mover de mes
            </button>
          </div>

          <!-- Cuotas -->
          <div class="ds-card overflow-x-auto">
            <table class="ds-table">
              <thead>
                <tr>
                  <th class="w-10"><span class="sr-only">Seleccionar</span></th>
                  <th>Período</th>
                  <th>Monto USD</th>
                  <th>En pesos</th>
                  <th>Estado</th>
                  <th>Cobro</th>
                  <th class="w-32"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody v-if="data.cuotas.length">
                <tr v-for="c in data.cuotas" :key="c.id">
                  <td>
                    <input
                      type="checkbox"
                      class="accent-[#0F7660]"
                      :checked="seleccion.has(c.id)"
                      :disabled="c.cobrado"
                      :title="c.cobrado ? 'Cobrada: primero descobrala' : ''"
                      aria-label="Seleccionar cuota"
                      @change="toggleSeleccion(c)"
                    />
                  </td>
                  <td class="font-medium text-ink">{{ MESES[c.mes - 1] }} {{ c.anio }}</td>
                  <td class="tnum font-medium text-ink">US$ {{ Number(c.montoUsd).toLocaleString('es-AR') }}</td>
                  <td class="tnum text-ink-soft">{{ fmtMoneda(c.enPesos) }}</td>
                  <td>
                    <span :class="c.cobrado ? 'ds-badge-ok' : 'ds-badge-warn'">
                      {{ c.cobrado ? 'Cobrada' : 'Pendiente' }}
                    </span>
                  </td>
                  <td>
                    <template v-if="c.cobrado">
                      <p class="tnum text-ink text-sm">{{ fmtMoneda(c.montoPesos ?? 0) }}</p>
                      <p class="text-2xs text-ink-faint tnum">{{ fmtFecha(c.fechaCobro) }} · @ {{ Number(c.cotizacion) }}</p>
                    </template>
                    <span v-else class="text-ink-faint text-xs">—</span>
                  </td>
                  <td>
                    <div class="flex items-center justify-end gap-0.5">
                      <template v-if="!c.cobrado">
                        <button v-if="meStore.can('cobranzas:cobrar')" class="row-action !text-ok" title="Cobrar" aria-label="Cobrar" @click="cobrar(c)">
                          <IonIcon :icon="checkmarkCircleOutline" class="text-[16px]" />
                        </button>
                        <button v-if="meStore.can('cobranzas:update')" class="row-action" title="Editar monto" aria-label="Editar monto" @click="editarMonto(c)">
                          <IonIcon :icon="createOutline" class="text-[15px]" />
                        </button>
                        <button v-if="meStore.can('cobranzas:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="eliminarCuota(c)">
                          <IonIcon :icon="trashOutline" class="text-[15px]" />
                        </button>
                      </template>
                      <button v-else-if="meStore.can('cobranzas:descobrar')" class="row-action" title="Descobrar" aria-label="Descobrar" @click="descobrar(c)">
                        <IonIcon :icon="arrowUndoOutline" class="text-[15px]" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
              <tbody v-else>
                <tr>
                  <td colspan="7" class="!h-auto">
                    <div class="flex flex-col items-center py-10 text-center">
                      <p class="text-sm font-medium text-ink">Sin cuotas planificadas</p>
                      <p class="text-xs text-ink-faint mt-1">Agregá la primera con «Agregar cuota».</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Auditoría -->
          <section v-if="data.eventos.length" class="mt-6">
            <h2 class="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
              <IonIcon :icon="timeOutline" class="text-[15px] text-ink-faint" />
              Auditoría de cobranzas
            </h2>
            <div class="ds-card divide-y divide-line-soft">
              <div v-for="e in data.eventos" :key="e.id" class="flex items-center gap-3 px-4 py-2 min-h-[38px]">
                <span
                  class="shrink-0 w-28 justify-center"
                  :class="{
                    'ds-badge-ok': e.tipo === 'cobrada',
                    'ds-badge-warn': e.tipo === 'descobrada',
                    'ds-badge-danger': e.tipo === 'eliminada',
                    'ds-badge-neutral': !['cobrada', 'descobrada', 'eliminada'].includes(e.tipo),
                  }"
                >
                  {{ EVENTO_LABEL[e.tipo] ?? e.tipo }}
                </span>
                <p class="flex-1 min-w-0 text-sm text-ink-soft truncate">{{ e.detalle || '—' }}</p>
                <span class="hidden sm:block text-2xs text-ink-faint shrink-0">
                  {{ e.user ? `${e.user.name} ${e.user.lastName}` : '—' }}
                </span>
                <span class="text-2xs text-ink-faint tnum shrink-0">{{ fmtFecha(e.createdAt) }}</span>
              </div>
            </div>
          </section>
        </template>
      </div>

      <!-- Modal: agregar cuota -->
      <Teleport defer to="ion-app">
        <div v-if="modalAgregar" class="ds-modal-backdrop" @click.self="modalAgregar = false">
          <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-label="Agregar cuota">
            <h2 class="text-base font-semibold text-ink mb-1">Agregar cuota</h2>
            <p class="text-xs text-ink-soft mb-4">Planificada en dólares; respeta el tope del presupuesto.</p>
            <form class="space-y-3" @submit.prevent="agregarCuota">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="ds-label" for="cq-mes">Mes</label>
                  <select id="cq-mes" v-model.number="formCuota.mes" class="ds-input">
                    <option v-for="(m, i) in MESES" :key="i" :value="i + 1">{{ m }}</option>
                  </select>
                </div>
                <div>
                  <label class="ds-label" for="cq-anio">Año</label>
                  <input id="cq-anio" v-model.number="formCuota.anio" class="ds-input font-mono" type="number" min="2000" max="2100" />
                </div>
              </div>
              <div>
                <label class="ds-label" for="cq-usd">Monto (USD)</label>
                <input id="cq-usd" v-model="formCuota.montoUsd" class="ds-input font-mono" type="number" min="0.01" step="0.01" required />
              </div>
              <p v-if="modalError" class="ds-error" role="alert">{{ modalError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalAgregar = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!Number(formCuota.montoUsd)">Agregar</button>
              </footer>
            </form>
          </div>
        </div>
      </Teleport>

      <!-- Modal: mover selección -->
      <Teleport defer to="ion-app">
        <div v-if="modalMover" class="ds-modal-backdrop" @click.self="modalMover = false">
          <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-label="Mover cuotas">
            <h2 class="text-base font-semibold text-ink mb-1">Mover {{ seleccion.size }} cuota(s)</h2>
            <p class="text-xs text-ink-soft mb-4">Se replanifican al período elegido. Solo cuotas pendientes.</p>
            <form class="space-y-3" @submit.prevent="moverSeleccion">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="ds-label" for="mv-mes">Mes destino</label>
                  <select id="mv-mes" v-model.number="formMover.mes" class="ds-input">
                    <option v-for="(m, i) in MESES" :key="i" :value="i + 1">{{ m }}</option>
                  </select>
                </div>
                <div>
                  <label class="ds-label" for="mv-anio">Año destino</label>
                  <input id="mv-anio" v-model.number="formMover.anio" class="ds-input font-mono" type="number" min="2000" max="2100" />
                </div>
              </div>
              <p v-if="modalError" class="ds-error" role="alert">{{ modalError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalMover = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary">Mover</button>
              </footer>
            </form>
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
