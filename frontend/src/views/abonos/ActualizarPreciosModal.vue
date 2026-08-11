<script setup lang="ts">
/**
 * Modal de actualización de precios (individual o masiva): preview → aplicar.
 * ARS pide %, USD pide cotización (+ precio USD editable solo en modo individual).
 * El aplicar es idempotente (operationId) — un doble click no compone el aumento.
 */
import { ref, computed, watch } from 'vue'
import { IonIcon } from '@ionic/vue'
import { closeOutline, trendingUpOutline } from 'ionicons/icons'
import { useAbonosStore } from '@/stores/abonos'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { moneda as fmtMoneda } from '@/composables/useFormato'

const props = defineProps<{
  open: boolean
  /** Ids de abonos ACTIVOS a actualizar. */
  ids: number[]
  /** Monedas presentes en la selección (define qué campos pedir). */
  hayArs: boolean
  hayUsd: boolean
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'applied'): void }>()

const abonosStore = useAbonosStore()
const toast = useToast()

const isOpen = computed(() => props.open)
useEscapeToClose(isOpen, () => emit('close'))

const paso = ref<'form' | 'preview'>('form')
const porcentaje = ref('')
const cotizacion = ref('')
const previewRows = ref<Array<Record<string, unknown>>>([])
const busy = ref(false)
const error = ref('')

watch(() => props.open, (open) => {
  if (open) { paso.value = 'form'; porcentaje.value = ''; cotizacion.value = ''; error.value = '' }
})

const canPreview = computed(() =>
  (!props.hayArs || porcentaje.value.trim() !== '') && (!props.hayUsd || cotizacion.value.trim() !== '')
)

async function verPreview(): Promise<void> {
  if (!canPreview.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await abonosStore.actualizarPreview(props.ids, {
      porcentaje: porcentaje.value || undefined,
      cotizacion: cotizacion.value || undefined,
    })
    if (!res.success) { error.value = res.message; return }
    previewRows.value = res.data.rows
    paso.value = 'preview'
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al calcular'
  } finally {
    busy.value = false
  }
}

async function aplicar(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await abonosStore.actualizarAplicar(props.ids, {
      porcentaje: porcentaje.value || undefined,
      cotizacion: cotizacion.value || undefined,
    })
    if (!res.success) { error.value = res.message; return }
    toast.success(`Se actualizaron ${res.data.aplicados} abono(s)`)
    emit('applied')
    emit('close')
  } catch (e: unknown) {
    error.value = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al aplicar'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ds-modal-backdrop" @click.self="emit('close')">
      <div class="ds-modal !max-w-xl ds-enter" role="dialog" aria-modal="true" aria-label="Actualizar precios">
        <header class="flex items-center justify-between px-5 h-12 border-b border-line sticky top-0 bg-surface z-10">
          <div class="flex items-center gap-2">
            <IonIcon :icon="trendingUpOutline" class="text-[16px] text-accent-ink" />
            <h2 class="text-sm font-semibold text-ink">Actualizar precios · {{ ids.length }} abono(s)</h2>
          </div>
          <button class="grid place-items-center w-7 h-7 rounded-md text-ink-faint hover:bg-surface-2 hover:text-ink" aria-label="Cerrar" @click="emit('close')">
            <IonIcon :icon="closeOutline" class="text-[17px]" />
          </button>
        </header>

        <div class="p-5">
          <template v-if="paso === 'form'">
            <div class="grid sm:grid-cols-2 gap-3">
              <div v-if="hayArs">
                <label class="ds-label" for="act-pct">Porcentaje (abonos en pesos)</label>
                <input id="act-pct" v-model="porcentaje" class="ds-input font-mono" type="text" inputmode="decimal" placeholder="Ej: 15" />
                <p class="ds-hint">Acepta negativos. El resultado se redondea al múltiplo configurado.</p>
              </div>
              <div v-if="hayUsd">
                <label class="ds-label" for="act-cotiz">Cotización (abonos en dólares)</label>
                <input id="act-cotiz" v-model="cotizacion" class="ds-input font-mono" type="text" inputmode="decimal" placeholder="Ej: 1200" />
                <p class="ds-hint">El precio en USD se mantiene; se registra la cotización y se reinicia el reloj.</p>
              </div>
            </div>

            <p v-if="error" class="ds-error" role="alert">{{ error }}</p>

            <footer class="flex justify-end gap-2 mt-5">
              <button type="button" class="ds-btn-secondary" @click="emit('close')">Cancelar</button>
              <button type="button" class="ds-btn-primary" :disabled="!canPreview || busy" @click="verPreview">
                {{ busy ? 'Calculando…' : 'Ver vista previa' }}
              </button>
            </footer>
          </template>

          <template v-else>
            <div class="border border-line rounded-lg overflow-x-auto">
              <table class="ds-table">
                <thead>
                  <tr><th>Abono</th><th>Anterior</th><th>Nuevo</th></tr>
                </thead>
                <tbody>
                  <tr v-for="r in previewRows" :key="String(r.abonoId)">
                    <td>
                      <p class="font-medium text-ink">{{ r.cliente }}</p>
                      <p class="text-2xs text-ink-faint">{{ r.servicio }}{{ r.descripcion ? ` · ${r.descripcion}` : '' }}</p>
                    </td>
                    <td class="tnum text-ink-soft">{{ fmtMoneda(Number(r.precioAnterior), r.moneda as 'ARS' | 'USD') }}</td>
                    <td>
                      <span class="tnum font-medium text-ink">{{ fmtMoneda(Number(r.precioNuevo), r.moneda as 'ARS' | 'USD') }}</span>
                      <span v-if="r.precioPesos" class="text-2xs text-ink-faint ml-1">≈ {{ fmtMoneda(Number(r.precioPesos)) }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-if="error" class="ds-error" role="alert">{{ error }}</p>

            <footer class="flex justify-between gap-2 mt-5">
              <button type="button" class="ds-btn-ghost" @click="paso = 'form'">Volver</button>
              <div class="flex gap-2">
                <button type="button" class="ds-btn-secondary" @click="emit('close')">Cancelar</button>
                <button type="button" class="ds-btn-primary" :disabled="busy" @click="aplicar">
                  {{ busy ? 'Aplicando…' : 'Confirmar actualización' }}
                </button>
              </div>
            </footer>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
