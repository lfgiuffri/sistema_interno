<script setup lang="ts">
/**
 * Grilla anual de cobranzas: proyectos × 12 meses, totales por mes y gran total.
 * Las celdas 100% pendientes se pueden arrastrar a otro mes de la misma fila
 * (drag & drop → PATCH mover). Las cobradas quedan fijas (montos congelados).
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import { chevronBackOutline, chevronForwardOutline, gridOutline } from 'ionicons/icons'
import { useProyectosStore, ESTADOS_PROYECTO } from '@/stores/proyectos'
import CotizacionDolar from '@/components/shared/CotizacionDolar.vue'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { moneda as fmtMoneda, MESES } from '@/composables/useFormato'

interface Celda { pesos: number; usd: number; cobradas: number; cantidad: number; ids: number[] }
interface Fila {
  id: number
  nombre: string
  cliente?: string
  moneda: 'ARS' | 'USD'
  total: number
  estado: string
  celdas: Record<number, Celda | null>
  totalPesos: number
  totalUsd: number
}
interface Grilla {
  anio: number
  anios: number[]
  cotizacion: number
  filas: Fila[]
  totalesMes: Record<number, { pesos: number; usd: number }>
  granTotal: { pesos: number; usd: number }
}

const store = useProyectosStore()
const meStore = useMeStore()
const toast = useToast()
const router = useRouter()

const anio = ref(new Date().getFullYear())
const grilla = ref<Grilla | null>(null)
const loading = ref(false)

// Solo filas con algo planificado en el año (la grilla del legado mostraba todo; acá filtramos ruido).
const filas = computed(() => (grilla.value?.filas ?? []).filter(f => f.totalPesos > 0 || f.totalUsd > 0))

// Estado del drag en curso.
const drag = ref<{ proyectoId: number; ids: number[]; mes: number } | null>(null)
const dragOver = ref<{ proyectoId: number; mes: number } | null>(null)

const puedeMover = computed(() => meStore.can('cobranzas:mover'))

async function load(): Promise<void> {
  loading.value = true
  try {
    grilla.value = await store.fetchGrilla(anio.value)
  } catch {
    toast.error('No se pudo cargar la grilla')
  } finally {
    loading.value = false
  }
}

function cambiarAnio(delta: number): void {
  anio.value += delta
  void load()
}

/** Una celda es arrastrable si existe, no tiene cuotas cobradas y hay permiso. */
function esArrastrable(celda: Celda | null): boolean {
  return !!celda && celda.cobradas === 0 && puedeMover.value
}

function onDragStart(fila: Fila, mes: number, e: DragEvent): void {
  const celda = fila.celdas[mes]
  if (!esArrastrable(celda)) { e.preventDefault(); return }
  drag.value = { proyectoId: fila.id, ids: celda!.ids, mes }
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(fila: Fila, mes: number, e: DragEvent): void {
  // Solo se puede soltar en otra celda de la MISMA fila (mismo proyecto).
  if (!drag.value || drag.value.proyectoId !== fila.id || drag.value.mes === mes) return
  e.preventDefault()
  dragOver.value = { proyectoId: fila.id, mes }
}

async function onDrop(fila: Fila, mes: number): Promise<void> {
  const d = drag.value
  drag.value = null
  dragOver.value = null
  if (!d || d.proyectoId !== fila.id || d.mes === mes) return
  const r = await store.moverCuotas(fila.id, d.ids, anio.value, mes)
  if (!r.ok) { toast.error(r.message); return }
  toast.success(`Cuotas movidas a ${MESES[mes - 1]}`)
  await load()
}

function onDragEnd(): void {
  drag.value = null
  dragOver.value = null
}

/**
 * Dólares con formato local y sin decimales (van SIEMPRE debajo del peso, más chicos:
 * la grilla se lee de un vistazo sin tener que abrir tooltips).
 * @param usd - Monto en dólares.
 * @returns Texto tipo «US$ 1.500».
 */
function fmtUsd(usd: number): string {
  return `US$ ${Math.round(usd).toLocaleString('es-AR')}`
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
      <div class="w-full px-4 lg:px-6 py-6 ds-enter">

        <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Grilla de cobranzas</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              Planificación anual por proyecto.
              <span class="hidden lg:inline">Arrastrá una celda pendiente para moverla de mes.</span>
              <span class="lg:hidden">Deslizá la tabla de costado para ver todos los meses.</span>
            </p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <CotizacionDolar v-if="grilla" :valor="grilla.cotizacion" @actualizada="load()" />
            <div class="flex items-center gap-1">
            <button class="ds-btn-secondary h-8 w-8 !px-0" aria-label="Año anterior" @click="cambiarAnio(-1)">
              <IonIcon :icon="chevronBackOutline" class="text-[15px]" />
            </button>
            <select v-model.number="anio" class="ds-input h-8 w-24 text-center font-mono" @change="load()">
              <option v-for="a in grilla?.anios ?? [anio]" :key="a" :value="a">{{ a }}</option>
            </select>
            <button class="ds-btn-secondary h-8 w-8 !px-0" aria-label="Año siguiente" @click="cambiarAnio(1)">
              <IonIcon :icon="chevronForwardOutline" class="text-[15px]" />
            </button>
            </div>
          </div>
        </header>

        <div v-if="loading && !grilla" class="ds-skeleton h-64"></div>

        <template v-if="grilla">
          <div v-if="filas.length" class="ds-card overflow-x-auto">
            <table class="grilla-table">
              <thead>
                <tr>
                  <th class="col-proyecto text-left">Proyecto</th>
                  <th class="col-presupuesto">Presupuesto</th>
                  <th v-for="(m, i) in MESES" :key="i" class="celda">{{ m.slice(0, 3) }}</th>
                  <th class="col-total">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in filas" :key="f.id">
                  <td class="col-proyecto">
                    <button class="text-left w-full group" @click="router.push(`/proyectos/${f.id}/cobranzas`)">
                      <p class="font-medium text-ink text-[13px] truncate group-hover:text-accent transition-colors">{{ f.nombre }}</p>
                      <p class="text-2xs text-ink-faint truncate">{{ f.cliente }} · {{ ESTADOS_PROYECTO[f.estado]?.label ?? f.estado }}</p>
                    </button>
                  </td>
                  <td class="col-presupuesto">
                    <span class="tnum text-ink block leading-tight">{{ fmtMoneda(f.total, f.moneda) }}</span>
                    <span class="text-2xs text-ink-faint font-mono">{{ f.moneda }}</span>
                  </td>
                  <td
                    v-for="mes in 12"
                    :key="mes"
                    class="celda"
                    :class="{ 'celda-drop': dragOver && dragOver.proyectoId === f.id && dragOver.mes === mes && drag }"
                    @dragover="onDragOver(f, mes, $event)"
                    @dragleave="dragOver = null"
                    @drop="onDrop(f, mes)"
                  >
                    <div
                      v-if="f.celdas[mes]"
                      class="chip"
                      :class="{
                        'chip-cobrada': f.celdas[mes]!.cobradas === f.celdas[mes]!.cantidad,
                        'chip-parcial': f.celdas[mes]!.cobradas > 0 && f.celdas[mes]!.cobradas < f.celdas[mes]!.cantidad,
                        'chip-movible': esArrastrable(f.celdas[mes]),
                      }"
                      :draggable="esArrastrable(f.celdas[mes])"
                      :title="`${fmtMoneda(f.celdas[mes]!.pesos)} · US$ ${f.celdas[mes]!.usd.toLocaleString('es-AR')} · ${f.celdas[mes]!.cobradas}/${f.celdas[mes]!.cantidad} cobrada(s)${esArrastrable(f.celdas[mes]) ? ' — arrastrá para mover' : ''}`"
                      @dragstart="onDragStart(f, mes, $event)"
                      @dragend="onDragEnd"
                    >
                      <span class="tnum font-medium leading-tight">
                        {{ fmtMoneda(f.celdas[mes]!.pesos) }}
                        <span v-if="f.celdas[mes]!.cantidad > 1" class="text-2xs opacity-70">×{{ f.celdas[mes]!.cantidad }}</span>
                      </span>
                      <span class="tnum text-2xs opacity-70 leading-tight">{{ fmtUsd(f.celdas[mes]!.usd) }}</span>
                    </div>
                  </td>
                  <td class="col-total">
                    <span class="tnum font-medium text-ink block leading-tight">{{ fmtMoneda(f.totalPesos) }}</span>
                    <span class="tnum text-2xs text-ink-faint block leading-tight">{{ fmtUsd(f.totalUsd) }}</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td class="col-proyecto text-2xs font-medium uppercase tracking-wide text-ink-faint">Total mes</td>
                  <td class="col-presupuesto"></td>
                  <td v-for="mes in 12" :key="mes" class="celda text-xs">
                    <template v-if="grilla.totalesMes[mes]?.pesos">
                      <span class="tnum font-medium text-ink block leading-tight">{{ fmtMoneda(grilla.totalesMes[mes].pesos) }}</span>
                      <span class="tnum text-2xs text-ink-faint block leading-tight">{{ fmtUsd(grilla.totalesMes[mes].usd) }}</span>
                    </template>
                    <span v-else class="text-ink-faint">—</span>
                  </td>
                  <td class="col-total">
                    <span class="tnum font-semibold text-accent-ink block leading-tight">{{ fmtMoneda(grilla.granTotal.pesos) }}</span>
                    <span class="tnum text-2xs text-ink-faint block leading-tight">{{ fmtUsd(grilla.granTotal.usd) }}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div v-else class="ds-card flex flex-col items-center py-14 text-center">
            <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
              <IonIcon :icon="gridOutline" class="text-[18px] text-ink-faint" />
            </div>
            <p class="text-sm font-medium text-ink">Sin cobranzas planificadas en {{ anio }}</p>
            <p class="text-xs text-ink-faint mt-1">Agregá cuotas desde la ficha de cada proyecto.</p>
          </div>

          <div class="flex flex-wrap items-center gap-4 mt-3 text-2xs text-ink-faint">
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded chip-cobrada inline-block"></span> Cobrado</span>
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded chip-parcial inline-block"></span> Parcial</span>
            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded chip-demo inline-block"></span> Pendiente (arrastrable)</span>
            <span class="ml-auto">
              <CotizacionDolar variante="texto" :valor="grilla.cotizacion" @actualizada="load()" />
            </span>
          </div>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }

/* table-layout fijo + anchos porcentuales: la grilla entra completa en el ancho de la
   pantalla, sin scroll horizontal (el número manda, no el ancho del contenido). */
.grilla-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 11.5px; }
.grilla-table th {
  height: 36px; padding: 0 3px; text-align: center; white-space: nowrap;
  font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em;
  color: rgb(var(--s-ink-faint)); border-bottom: 1px solid rgb(var(--s-line));
  background: rgb(var(--s-surface-2) / 0.5);
}
.grilla-table td {
  height: 52px; padding: 3px 2px; text-align: center;
  border-bottom: 1px solid rgb(var(--s-line-soft));
}
.grilla-table tbody tr:hover td { background: rgb(var(--s-surface-2) / 0.4); }
.grilla-table tfoot td { border-bottom: none; border-top: 1px solid rgb(var(--s-line)); height: 40px; }
.col-proyecto { width: 13%; text-align: left !important; padding-left: 12px !important; }
/* 9% y no 7%: con 7% el encabezado «PRESUPUESTO» en mayúsculas no entra y se corta. */
.col-presupuesto { width: 9%; }
.col-total { width: 8%; }
/* 12 meses repartiendo el resto (~5.8% cada uno). */
.celda { width: 5.8%; }
.celda-drop { outline: 2px dashed rgb(var(--s-accent)); outline-offset: -3px; border-radius: 8px; background: rgb(var(--s-accent-soft)) !important; }

/* ── Celular ────────────────────────────────────────────────────────────────────────
   Meter 15 columnas en 390px no las hace chicas: las hace ilegibles. Cada mes queda en
   ~21px, los encabezados se pisan entre sí («PROYEPRESUFEEBMOAR…») y los montos se parten
   en cuatro renglones. Acá el ancho fijo NO sirve: la grilla pasa a tener un ancho mínimo y
   se recorre de costado dentro del contenedor que ya tenía `overflow-x-auto`.

   La columna del proyecto queda FIJA al desplazarse: sin eso, al llegar a Septiembre no
   sabés de qué proyecto es la fila que estás mirando, y la grilla no sirve para nada. */
@media (max-width: 1023px) {
  .grilla-table { width: auto; min-width: 900px; table-layout: auto; }
  /* Los porcentajes dejan de aplicar: cada columna pide lo que necesita. */
  .col-proyecto { width: 150px; min-width: 150px; }
  .col-presupuesto { width: 92px; }
  .col-total { width: 104px; }
  .celda { width: 62px; }

  .grilla-table .col-proyecto {
    position: sticky; left: 0; z-index: 2;
    /* Fondo opaco obligatorio: si no, se ve pasar el contenido por debajo. */
    background: rgb(var(--s-surface));
    box-shadow: 1px 0 0 rgb(var(--s-line));
  }
  .grilla-table thead .col-proyecto { z-index: 3; background: rgb(var(--s-surface-2)); }
  .grilla-table tfoot .col-proyecto { background: rgb(var(--s-surface)); }
  /* El hover pinta la fila entera, así que la celda fija tiene que acompañar. */
  .grilla-table tbody tr:hover .col-proyecto { background: rgb(var(--s-surface-2)); }
}

/* Los dos números NUNCA se parten: prefiero achicar la tipografía a que el monto quede
   cortado en dos renglones (el punto de la grilla es leerlo de un vistazo). */
.chip {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 100%; padding: 3px 2px; border-radius: 7px; white-space: nowrap; font-size: 10.5px;
  background: rgb(var(--s-surface-2)); border: 1px solid rgb(var(--s-line));
  color: rgb(var(--s-ink)); user-select: none;
}
.chip-movible { cursor: grab; }
.chip-movible:active { cursor: grabbing; }
.chip-cobrada {
  background: rgb(var(--s-ok) / 0.12); border-color: rgb(var(--s-ok) / 0.35);
  color: rgb(var(--s-ok));
}
.chip-parcial {
  background: rgb(var(--s-warn) / 0.12); border-color: rgb(var(--s-warn) / 0.35);
  color: rgb(var(--s-warn));
}
.chip-demo { background: rgb(var(--s-surface-2)); border: 1px solid rgb(var(--s-line)); }
</style>
