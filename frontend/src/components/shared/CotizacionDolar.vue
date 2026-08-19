<script setup lang="ts">
/**
 * Cotización del dólar: la muestra y deja editarla ahí mismo, sin ir a Configuración.
 *
 * Nació en el panel y se comparte porque el valor se necesita justo donde se leen los montos
 * —abonos, cobranzas, grilla— y ahí es donde uno se da cuenta de que está desactualizado.
 * Editar en el lugar evita el viaje a Configuración y volver.
 *
 * Sin `configuracion:update` sigue mostrando el valor y el histórico: ver la cotización no es
 * lo mismo que poder cambiarla.
 *
 * El componente NO recarga los datos de la pantalla: emite `actualizada` y cada vista decide
 * qué volver a pedir (los montos en pesos dependen de este número, así que hay que refrescar).
 */
import { ref } from 'vue'
import { IonIcon } from '@ionic/vue'
import { createOutline } from 'ionicons/icons'
import api, { apiErrorMessage } from '@/services/api'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { moneda as fmtMoneda, fechaHora } from '@/composables/useFormato'

const props = defineProps<{
  /** Valor vigente, tal como lo devolvió el endpoint de la pantalla. */
  valor: number | null | undefined
  /** `chip` (default): botón con borde, para el encabezado. `texto`: enlace discreto, para un pie. */
  variante?: 'chip' | 'texto'
}>()
const emit = defineEmits<{ (e: 'actualizada', valor: number): void }>()

const meStore = useMeStore()
const toast = useToast()

const abierto = ref(false)
const entrada = ref('')
const guardando = ref(false)
const historico = ref<Array<{ id: number; valor: number; fecha: string; usuario?: string | null }>>([])
useEscapeToClose(abierto, () => { abierto.value = false })

/** Abre el modal con el valor actual cargado y trae el histórico. */
async function abrir(): Promise<void> {
  entrada.value = String(props.valor ?? '')
  abierto.value = true
  try {
    const res = await api.get('/app-config/cotizaciones')
    if (res.data.success) historico.value = res.data.data
  } catch { historico.value = [] }
}

async function guardar(): Promise<void> {
  const nuevo = Number(entrada.value)
  if (!Number.isFinite(nuevo) || nuevo <= 0) { toast.error('La cotización tiene que ser mayor a 0'); return }
  guardando.value = true
  try {
    const res = await api.put('/app-config', { name: 'COTIZACION_DOLAR', value: entrada.value })
    if (!res.data.success) { toast.error(res.data.message); return }
    toast.success('Cotización actualizada')
    abierto.value = false
    emit('actualizada', nuevo)
  } catch (e) {
    toast.error(apiErrorMessage(e))
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <button
    v-if="variante === 'texto'"
    class="tnum text-ink-faint hover:text-ink underline decoration-dotted underline-offset-2 transition-colors"
    :title="meStore.can('configuracion:update') ? 'Ver y editar la cotización' : 'Ver la cotización'"
    @click="abrir()"
  >
    Cotización {{ fmtMoneda(valor ?? 0) }}
  </button>

  <button
    v-else
    class="flex items-center gap-2 px-3 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-2 transition-colors shrink-0"
    :title="meStore.can('configuracion:update') ? 'Ver y editar la cotización' : 'Ver la cotización'"
    @click="abrir()"
  >
    <span class="text-ink-faint text-xs">Dólar</span>
    <span class="tnum font-semibold text-ink">{{ fmtMoneda(valor ?? 0) }}</span>
    <IonIcon v-if="meStore.can('configuracion:update')" :icon="createOutline" class="text-[13px] text-ink-faint" />
  </button>

  <Teleport defer to="ion-app">
    <div v-if="abierto" class="ds-modal-backdrop" @click.self="abierto = false">
      <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-label="Cotización del dólar">
        <h2 class="text-base font-semibold text-ink mb-1">Cotización del dólar</h2>
        <p class="text-xs text-ink-soft mb-3">Impacta en abonos USD, cuotas de proyectos y montos pendientes.</p>

        <form v-if="meStore.can('configuracion:update')" class="flex items-end gap-2 mb-4" @submit.prevent="guardar">
          <div class="flex-1">
            <label class="ds-label" for="cot-valor">Valor</label>
            <input id="cot-valor" v-model="entrada" class="ds-input font-mono" type="number" min="1" step="0.01" />
          </div>
          <button type="submit" class="ds-btn-primary" :disabled="guardando">
            {{ guardando ? 'Guardando…' : 'Guardar' }}
          </button>
        </form>

        <div>
          <p class="ds-label !mb-1">Histórico</p>
          <div v-if="historico.length" class="border border-line rounded-lg divide-y divide-line-soft max-h-56 overflow-y-auto">
            <div v-for="h in historico" :key="h.id" class="flex items-center gap-3 px-3 h-9 text-xs">
              <span class="tnum font-medium text-ink">{{ fmtMoneda(h.valor) }}</span>
              <span class="flex-1 text-ink-faint truncate">{{ h.usuario ?? '—' }}</span>
              <span class="text-ink-faint tnum">{{ fechaHora(h.fecha) }}</span>
            </div>
          </div>
          <p v-else class="text-2xs text-ink-faint">Sin cambios registrados todavía.</p>
        </div>

        <footer class="flex justify-end pt-3">
          <button type="button" class="ds-btn-secondary" @click="abierto = false">Cerrar</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
