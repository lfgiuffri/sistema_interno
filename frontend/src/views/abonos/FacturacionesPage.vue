<script setup lang="ts">
/**
 * Facturaciones — histórico mensual con anulación auditada (funcionalidad NUEVA vs legado,
 * PRD §10.2): filtros por período, total vigente y anular con motivo obligatorio.
 */
import { ref, onMounted } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import { banOutline, receiptOutline , downloadOutline
} from 'ionicons/icons'
import { descargarCsv } from '@/composables/useCsv'
import { useAbonosStore } from '@/stores/abonos'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { moneda as fmtMoneda, fecha as fmtFecha, MESES } from '@/composables/useFormato'
import type { PaginationMeta } from '@/types'

interface FactRow {
  id: number
  anio: number
  mes: number
  moneda: 'ARS' | 'USD'
  precio: string
  cotizacion?: string | null
  montoPesos: string
  fecha: string
  anuladaAt?: string | null
  motivoAnulacion?: string | null
  cliente?: { nombre: string }
  servicio?: { nombre: string }
  user?: { name: string; lastName: string } | null
}

const abonosStore = useAbonosStore()
const meStore = useMeStore()
const toast = useToast()

const hoy = new Date()
const anio = ref<number>(hoy.getFullYear())
const mes = ref<number | ''>('')
const incluirAnuladas = ref(false)
const rows = ref<FactRow[]>([])
const meta = ref<PaginationMeta | null>(null)
const totalPesos = ref(0)
const loading = ref(false)
const page = ref(1)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await abonosStore.fetchFacturaciones({
      anio: anio.value || undefined,
      mes: mes.value || undefined,
      incluirAnuladas: incluirAnuladas.value ? 'true' : undefined,
    }, page.value)
    if (res.success) {
      rows.value = res.data.rows
      totalPesos.value = res.data.totalPesos
      meta.value = res.meta ?? null
    }
  } finally {
    loading.value = false
  }
}

async function confirmAnular(fact: FactRow): Promise<void> {
  const alert = await alertController.create({
    header: 'Anular facturación',
    message: `${fact.cliente?.nombre} · ${MESES[fact.mes - 1]} ${fact.anio} · ${fmtMoneda(fact.montoPesos)}. La anulación queda auditada y el período se puede volver a facturar.`,
    inputs: [{ name: 'motivo', type: 'text', placeholder: 'Motivo de la anulación (obligatorio)' }],
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Anular', role: 'destructive',
        handler: async (data: { motivo?: string }) => {
          const motivo = (data.motivo ?? '').trim()
          if (!motivo) { toast.error('El motivo de la anulación es obligatorio'); return false }
          const r = await abonosStore.anularFacturacion(fact.id, motivo)
          if (!r.ok) { toast.error(r.message); return false }
          toast.success('Facturación anulada')
          await load()
          return true
        },
      },
    ],
  })
  await alert.present()
}

/** Export CSV del histórico visible (mejora §10.8). */
function exportarCsv(): void {
  descargarCsv('facturaciones',
    ['Año', 'Mes', 'Cliente', 'Servicio', 'Moneda', 'Precio', 'Cotización', 'Monto pesos', 'Estado'],
    rows.value.map(f => [
      f.anio, f.mes, f.cliente?.nombre ?? '', f.servicio?.nombre ?? '', f.moneda,
      f.precio, f.cotizacion ?? '', f.montoPesos, f.anuladaAt ? 'Anulada' : 'Vigente',
    ]))
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

        <header class="flex items-center justify-between gap-4 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Facturaciones</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Histórico de lo facturado, con montos congelados al momento de facturar.</p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-3">
          <button class="ds-btn-secondary" title="Exportar CSV" @click="exportarCsv">
            <IonIcon :icon="downloadOutline" class="text-[15px]" />
            CSV
          </button>
          <div class="text-right">
            <p class="text-2xs uppercase tracking-wide text-ink-faint">Total vigente (filtro)</p>
            <p class="text-lg font-semibold tnum text-ink">{{ fmtMoneda(totalPesos) }}</p>
          </div>
          </div>
        </header>

        <div class="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label class="ds-label" for="f-anio">Año</label>
            <input id="f-anio" v-model.number="anio" class="ds-input h-9 w-24 font-mono" type="number" min="2000" max="2100" @change="page = 1; load()" />
          </div>
          <div>
            <label class="ds-label" for="f-mes">Mes</label>
            <select id="f-mes" v-model="mes" class="ds-input h-9 w-40" @change="page = 1; load()">
              <option value="">Todos</option>
              <option v-for="(nombre, i) in MESES" :key="i" :value="i + 1">{{ nombre }}</option>
            </select>
          </div>
          <label class="flex items-center gap-2 h-9 text-sm text-ink-soft cursor-pointer select-none">
            <input v-model="incluirAnuladas" type="checkbox" class="accent-[#0F7660]" @change="page = 1; load()" />
            Incluir anuladas
          </label>
        </div>

        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th>Período</th><th>Cliente / Servicio</th><th>Precio</th><th>Monto (congelado)</th>
                <th>Facturada</th><th>Estado</th><th class="w-16"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="loading && !rows.length">
              <tr v-for="i in 5" :key="i"><td colspan="7" class="!px-3"><div class="ds-skeleton h-5 w-full my-2"></div></td></tr>
            </tbody>

            <tbody v-else-if="rows.length">
              <tr v-for="fact in rows" :key="fact.id" :class="{ 'opacity-45': fact.anuladaAt }">
                <td class="font-medium text-ink whitespace-nowrap">{{ MESES[fact.mes - 1] }} {{ fact.anio }}</td>
                <td>
                  <p class="font-medium text-ink">{{ fact.cliente?.nombre }}</p>
                  <p class="text-2xs text-ink-faint">{{ fact.servicio?.nombre }}</p>
                </td>
                <td>
                  <div class="flex items-center gap-1.5">
                    <span class="ds-badge-neutral !h-[18px] !text-2xs font-mono">{{ fact.moneda }}</span>
                    <span class="tnum text-ink-soft">{{ fmtMoneda(fact.precio, fact.moneda) }}</span>
                    <span v-if="fact.cotizacion" class="text-2xs text-ink-faint">@ {{ fmtMoneda(fact.cotizacion) }}</span>
                  </div>
                </td>
                <td class="tnum font-medium text-ink">{{ fmtMoneda(fact.montoPesos) }}</td>
                <td class="tnum text-ink-soft whitespace-nowrap">
                  {{ fmtFecha(fact.fecha) }}
                  <span v-if="fact.user" class="text-2xs text-ink-faint block">{{ fact.user.name }} {{ fact.user.lastName }}</span>
                </td>
                <td>
                  <span v-if="fact.anuladaAt" class="ds-badge-danger" :title="fact.motivoAnulacion ?? ''">Anulada</span>
                  <span v-else class="ds-badge-ok">Vigente</span>
                </td>
                <td>
                  <button
                    v-if="!fact.anuladaAt && meStore.can('facturaciones:anular')"
                    class="row-action hover:!text-danger" title="Anular" aria-label="Anular facturación"
                    @click="confirmAnular(fact)"
                  >
                    <IonIcon :icon="banOutline" class="text-[15px]" />
                  </button>
                </td>
              </tr>
            </tbody>

            <tbody v-else>
              <tr>
                <td colspan="7" class="!h-auto">
                  <div class="flex flex-col items-center py-12 text-center">
                    <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
                      <IonIcon :icon="receiptOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">Sin facturaciones en este período</p>
                    <p class="text-xs text-ink-faint mt-1">Facturá desde el listado de Abonos.</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="meta && meta.totalPages > 1" class="flex items-center justify-between mt-3 text-xs text-ink-soft">
          <span class="tnum">{{ meta.totalItems }} registro(s)</span>
          <div class="flex gap-1">
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!meta.hasPrevPage" @click="page--; load()">Anterior</button>
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!meta.hasNextPage" @click="page++; load()">Siguiente</button>
          </div>
        </div>
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
