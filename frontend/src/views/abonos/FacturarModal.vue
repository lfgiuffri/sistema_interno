<script setup lang="ts">
/**
 * Modal de facturación mensual: preview (detecta ya facturados) → aplicar (idempotente).
 * Congela precio + cotización + monto en pesos por (abono, año, mes).
 */
import { ref, computed, watch } from 'vue'
import { IonIcon } from '@ionic/vue'
import { closeOutline, receiptOutline } from 'ionicons/icons'
import { useAbonosStore } from '@/stores/abonos'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { moneda as fmtMoneda, MESES } from '@/composables/useFormato'

const props = defineProps<{ open: boolean; ids: number[] }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'applied'): void }>()

const abonosStore = useAbonosStore()
const toast = useToast()
const isOpen = computed(() => props.open)
useEscapeToClose(isOpen, () => emit('close'))

const hoy = new Date()
const anio = ref(hoy.getFullYear())
const mes = ref(hoy.getMonth() + 1)
const preview = ref<{ rows: Array<Record<string, unknown>>; total: number; aFacturar: number; yaFacturados: number } | null>(null)
const busy = ref(false)
const error = ref('')

watch(() => props.open, (open) => {
  if (open) { preview.value = null; error.value = ''; void cargarPreview() }
})
watch([anio, mes], () => { if (props.open) void cargarPreview() })

async function cargarPreview(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const res = await abonosStore.facturarPreview(props.ids, anio.value, mes.value)
    if (!res.success) { error.value = res.message; return }
    preview.value = res.data
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al calcular'
  } finally {
    busy.value = false
  }
}

async function aplicar(): Promise<void> {
  if (busy.value || !preview.value?.aFacturar) return
  busy.value = true
  try {
    const res = await abonosStore.facturarAplicar(props.ids, anio.value, mes.value)
    if (!res.success) { error.value = res.message; return }
    toast.success(`Se facturaron ${res.data.facturados} abono(s) · Total ${fmtMoneda(res.data.total)}`)
    emit('applied')
    emit('close')
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al facturar'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ds-modal-backdrop" @click.self="emit('close')">
      <div class="ds-modal !max-w-xl ds-enter" role="dialog" aria-modal="true" aria-label="Facturar abonos">
        <header class="flex items-center justify-between px-5 h-12 border-b border-line sticky top-0 bg-surface z-10">
          <div class="flex items-center gap-2">
            <IonIcon :icon="receiptOutline" class="text-[16px] text-accent-ink" />
            <h2 class="text-sm font-semibold text-ink">Facturar · {{ ids.length }} abono(s)</h2>
          </div>
          <button class="grid place-items-center w-7 h-7 rounded-md text-ink-faint hover:bg-surface-2 hover:text-ink" aria-label="Cerrar" @click="emit('close')">
            <IonIcon :icon="closeOutline" class="text-[17px]" />
          </button>
        </header>

        <div class="p-5">
          <div class="flex gap-3 mb-4">
            <div>
              <label class="ds-label" for="fact-mes">Mes</label>
              <select id="fact-mes" v-model.number="mes" class="ds-input h-9 pr-9">
                <option v-for="(nombre, i) in MESES" :key="i" :value="i + 1">{{ nombre }}</option>
              </select>
            </div>
            <div>
              <label class="ds-label" for="fact-anio">Año</label>
              <input id="fact-anio" v-model.number="anio" class="ds-input h-9 w-24 font-mono" type="number" min="2000" max="2100" />
            </div>
          </div>

          <div v-if="preview" class="border border-line rounded-lg overflow-x-auto">
            <table class="ds-table">
              <thead>
                <tr><th>Abono</th><th>A facturar</th><th>Estado</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in preview.rows" :key="String(r.abonoId)" :class="{ 'opacity-45': r.yaFacturado }">
                  <td>
                    <p class="font-medium text-ink">{{ r.cliente }}</p>
                    <p class="text-2xs text-ink-faint">{{ r.servicio }}{{ r.descripcion ? ` · ${r.descripcion}` : '' }}</p>
                  </td>
                  <td class="tnum">{{ fmtMoneda(Number(r.montoPesos)) }}</td>
                  <td>
                    <span v-if="r.yaFacturado" class="ds-badge-neutral">Ya facturado</span>
                    <span v-else class="ds-badge-ok">A facturar</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td class="font-semibold text-ink">TOTAL A FACTURAR ({{ preview.aFacturar }})</td>
                  <td class="tnum font-semibold text-ink" colspan="2">{{ fmtMoneda(preview.total) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div v-else class="ds-skeleton h-24 w-full"></div>

          <p v-if="preview && preview.yaFacturados > 0" class="ds-hint mt-2">
            {{ preview.yaFacturados }} abono(s) ya facturado(s) en este período se omiten (no se duplican).
          </p>
          <p v-if="error" class="ds-error" role="alert">{{ error }}</p>

          <footer class="flex justify-end gap-2 mt-5">
            <button type="button" class="ds-btn-secondary" @click="emit('close')">Cancelar</button>
            <button type="button" class="ds-btn-primary" :disabled="busy || !preview || preview.aFacturar === 0" @click="aplicar">
              {{ busy ? 'Facturando…' : `Facturar ${MESES[mes - 1]} ${anio}` }}
            </button>
          </footer>
        </div>
      </div>
    </div>
  </Teleport>
</template>
