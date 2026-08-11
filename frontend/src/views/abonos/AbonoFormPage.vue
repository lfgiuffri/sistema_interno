<script setup lang="ts">
/**
 * Alta/edición de abono — página aparte (ABM grande, convención del legado).
 * En edición muestra el historial de actualizaciones y la acción "Actualizar precio".
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  IonPage, IonContent, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonIcon,
} from '@ionic/vue'
import { chevronBackOutline, trendingUpOutline } from 'ionicons/icons'
import api from '@/services/api'
import { useAbonosStore, type Abono } from '@/stores/abonos'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { moneda as fmtMoneda, fecha as fmtFecha, porcentaje as fmtPct } from '@/composables/useFormato'
import ActualizarPreciosModal from './ActualizarPreciosModal.vue'

interface Opcion { value: number; label: string }
interface HistItem {
  id: number
  fecha: string
  tipo: 'porcentaje' | 'cotizacion'
  moneda: 'ARS' | 'USD'
  precioAnterior: string
  precioNuevo: string
  porcentaje?: string | null
  cotizacion?: string | null
  precioPesos?: string | null
  user?: { name: string; lastName: string } | null
}

const route = useRoute()
const router = useRouter()
const abonosStore = useAbonosStore()
const meStore = useMeStore()
const toast = useToast()

const id = computed(() => Number(route.params.id) || 0)
const isEdit = computed(() => id.value > 0)

const form = ref({
  clienteId: 0, servicioId: 0, descripcion: '', moneda: 'USD' as 'ARS' | 'USD',
  precio: '', fechaInicio: new Date().toISOString().slice(0, 10), periodoMeses: 12,
  formaFacturacionId: 0, observaciones: '', activo: false,
})
const abono = ref<Abono | null>(null)
const historial = ref<HistItem[]>([])
const clientes = ref<Opcion[]>([])
const servicios = ref<Opcion[]>([])
const formas = ref<Opcion[]>([])
const formError = ref('')
const modalActualizar = ref(false)

const canSave = computed(() =>
  form.value.clienteId > 0 && form.value.servicioId > 0
  && form.value.precio !== '' && Number(form.value.precio) >= 0
  && form.value.fechaInicio && form.value.periodoMeses >= 1
)

/** Carga los selects. Incluye TODO (los inactivos marcados): el valor actual no se pierde. */
async function loadOpciones(): Promise<void> {
  const [c, s, f] = await Promise.all([
    api.get('/clientes', { params: { limit: 200 } }),
    api.get('/servicios', { params: { limit: 200 } }),
    api.get('/formas-facturacion', { params: { limit: 200 } }),
  ])
  const mark = (r: { id: number; nombre: string; activo: boolean }) => ({ value: r.id, label: r.activo ? r.nombre : `${r.nombre} (inactivo)` })
  if (c.data.success) clientes.value = c.data.data.map(mark)
  if (s.data.success) servicios.value = s.data.data.map(mark)
  if (f.data.success) formas.value = f.data.data.map(mark)
}

async function loadAbono(): Promise<void> {
  if (!isEdit.value) return
  const res = await abonosStore.fetchOne(id.value)
  if (!res) { toast.error('Abono no encontrado'); router.replace('/abonos'); return }
  abono.value = res.abono
  historial.value = res.historial as HistItem[]
  form.value = {
    clienteId: res.abono.clienteId,
    servicioId: res.abono.servicioId,
    descripcion: res.abono.descripcion ?? '',
    moneda: res.abono.moneda,
    precio: String(res.abono.precio),
    fechaInicio: res.abono.fechaInicio,
    periodoMeses: res.abono.periodoMeses,
    formaFacturacionId: res.abono.formaFacturacionId ?? 0,
    observaciones: res.abono.observaciones ?? '',
    activo: res.abono.activo,
  }
}

async function save(): Promise<void> {
  if (!canSave.value || abonosStore.saving) return
  const payload: Record<string, unknown> = {
    ...form.value,
    precio: Number(form.value.precio),
    formaFacturacionId: form.value.formaFacturacionId || 0,
    descripcion: form.value.descripcion.trim() || undefined,
    observaciones: form.value.observaciones.trim() || undefined,
  }
  const r = await abonosStore.save(payload, isEdit.value ? id.value : undefined)
  if (!r.ok) { formError.value = r.message; return }
  toast.success(isEdit.value ? 'Abono actualizado' : 'Abono creado')
  router.replace('/abonos')
}

/** Detalle legible de una fila del historial. */
function detalleHist(h: HistItem): string {
  if (h.tipo === 'porcentaje') return `+${fmtPct(h.porcentaje ?? 0)}%`
  return `Cotiz. ${fmtMoneda(h.cotizacion ?? 0)}${h.precioPesos ? ` · ≈ ${fmtMoneda(h.precioPesos)}` : ''}`
}

onMounted(async () => {
  await Promise.all([loadOpciones(), loadAbono()])
})
</script>

<template>
  <IonPage>
    <IonHeader class="ion-no-border">
      <IonToolbar class="app-toolbar">
        <IonButtons slot="start" class="lg:hidden"><IonMenuButton /></IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent class="page-content">
      <div class="max-w-3xl mx-auto px-5 lg:px-8 py-6 ds-enter">

        <button class="ds-btn-ghost h-8 -ml-2 mb-3" @click="router.back()">
          <IonIcon :icon="chevronBackOutline" class="text-[14px]" />
          Abonos
        </button>

        <header class="flex items-center justify-between gap-4 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">
              {{ isEdit ? `Editar abono · ${abono?.cliente?.nombre ?? ''}` : 'Nuevo abono' }}
            </h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              El abono se activa cuando el proyecto está terminado. Los inactivos no se facturan ni cuentan en los totales.
            </p>
          </div>
          <button
            v-if="isEdit && abono?.activo && meStore.can('abonos:actualizar-precio')"
            class="ds-btn-secondary"
            @click="modalActualizar = true"
          >
            <IonIcon :icon="trendingUpOutline" class="text-[15px]" />
            Actualizar precio
          </button>
        </header>

        <form class="ds-card p-5 space-y-4" @submit.prevent="save">
          <div class="grid sm:grid-cols-2 gap-3">
            <div>
              <label class="ds-label" for="ab-cliente">Cliente</label>
              <select id="ab-cliente" v-model.number="form.clienteId" class="ds-input" required>
                <option :value="0" disabled>Elegí un cliente…</option>
                <option v-for="o in clientes" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
            <div>
              <label class="ds-label" for="ab-servicio">Servicio</label>
              <select id="ab-servicio" v-model.number="form.servicioId" class="ds-input" required>
                <option :value="0" disabled>Elegí un servicio…</option>
                <option v-for="o in servicios" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>

          <div>
            <label class="ds-label" for="ab-desc">Descripción / referencia</label>
            <input id="ab-desc" v-model="form.descripcion" class="ds-input" type="text" placeholder="Ej: E-commerce principal" />
            <p class="ds-hint">Para distinguir dos abonos del mismo servicio.</p>
          </div>

          <div class="grid sm:grid-cols-3 gap-3">
            <div>
              <label class="ds-label" for="ab-moneda">Moneda</label>
              <select id="ab-moneda" v-model="form.moneda" class="ds-input">
                <option value="USD">Dólares (USD)</option>
                <option value="ARS">Pesos (ARS)</option>
              </select>
            </div>
            <div>
              <label class="ds-label" for="ab-precio">Precio</label>
              <input id="ab-precio" v-model="form.precio" class="ds-input font-mono" type="number" min="0" step="0.01" required />
              <p v-if="isEdit" class="ds-hint">Para aumentos usá «Actualizar precio» (queda en el historial).</p>
            </div>
            <div>
              <label class="ds-label" for="ab-periodo">Actualizar cada (meses)</label>
              <input id="ab-periodo" v-model.number="form.periodoMeses" class="ds-input font-mono" type="number" min="1" required />
            </div>
          </div>

          <div class="grid sm:grid-cols-2 gap-3">
            <div>
              <label class="ds-label" for="ab-inicio">Fecha de inicio</label>
              <input id="ab-inicio" v-model="form.fechaInicio" class="ds-input" type="date" required />
            </div>
            <div>
              <label class="ds-label" for="ab-forma">Forma de facturación</label>
              <select id="ab-forma" v-model.number="form.formaFacturacionId" class="ds-input">
                <option :value="0">— Sin especificar —</option>
                <option v-for="o in formas" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>

          <div>
            <label class="ds-label" for="ab-obs">Observaciones</label>
            <textarea id="ab-obs" v-model="form.observaciones" class="ds-input !h-auto min-h-[64px] py-2" rows="2"></textarea>
          </div>

          <label class="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
            <input v-model="form.activo" type="checkbox" class="accent-[#0F7660]" />
            Abono activo (se factura y cuenta en los totales)
          </label>

          <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>

          <footer class="flex justify-end gap-2 pt-1">
            <button type="button" class="ds-btn-secondary" @click="router.back()">Cancelar</button>
            <button type="submit" class="ds-btn-primary" :disabled="!canSave || abonosStore.saving">
              {{ abonosStore.saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear abono') }}
            </button>
          </footer>
        </form>

        <!-- Historial de actualizaciones -->
        <section v-if="isEdit && historial.length" class="mt-6">
          <h2 class="text-sm font-semibold text-ink mb-2">Historial de actualizaciones</h2>
          <div class="ds-card overflow-x-auto">
            <table class="ds-table">
              <thead>
                <tr><th>Fecha</th><th>Tipo</th><th>Anterior</th><th>Nuevo</th><th>Detalle</th><th>Usuario</th></tr>
              </thead>
              <tbody>
                <tr v-for="h in historial" :key="h.id">
                  <td class="tnum text-ink-soft">{{ fmtFecha(h.fecha) }}</td>
                  <td><span class="ds-badge-neutral">{{ h.tipo === 'porcentaje' ? 'Porcentaje' : 'Cotización USD' }}</span></td>
                  <td class="tnum text-ink-soft">{{ fmtMoneda(h.precioAnterior, h.moneda) }}</td>
                  <td class="tnum font-medium text-ink">{{ fmtMoneda(h.precioNuevo, h.moneda) }}</td>
                  <td class="text-ink-soft text-xs">{{ detalleHist(h) }}</td>
                  <td class="text-ink-soft text-xs">{{ h.user ? `${h.user.name} ${h.user.lastName}` : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <ActualizarPreciosModal
        v-if="abono"
        :open="modalActualizar"
        :ids="[abono.id]"
        :hay-ars="abono.moneda === 'ARS'"
        :hay-usd="abono.moneda === 'USD'"
        @close="modalActualizar = false"
        @applied="loadAbono()"
      />
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
</style>
