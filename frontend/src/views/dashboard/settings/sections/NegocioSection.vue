<template>
  <SettingSection
    title="Parámetros del negocio"
    description="Valores que usan abonos, cobranzas, tareas y el panel"
    :icon="businessOutline"
  >
    <p v-if="cargando" class="hint-text">Cargando…</p>

    <template v-else-if="claves.length">
      <SettingRow
        v-for="c in claves"
        :key="c.name"
        :label="c.label"
        :hint="c.description"
      >
        <div class="valor-row">
          <input
            v-model="borrador[c.name]"
            class="valor-input"
            :type="c.tipo === 'texto' ? 'text' : 'number'"
            :min="1"
            :step="c.name === 'COTIZACION_DOLAR' ? '0.01' : '1'"
            :disabled="!puedeEditar"
            @keyup.enter="guardar(c.name)"
          />
          <button
            v-if="puedeEditar"
            class="action-btn-sm"
            :disabled="guardando === c.name || borrador[c.name] === c.value"
            @click="guardar(c.name)"
          >
            {{ guardando === c.name ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </SettingRow>

      <p v-if="!puedeEditar" class="hint-text">
        Solo lectura: necesitás el permiso <code>configuracion:update</code> para cambiarlos.
      </p>
      <p v-else class="hint-text">
        Cada cambio de la cotización queda registrado en el histórico (se ve desde el Panel).
      </p>
    </template>

    <p v-else class="hint-text">No tenés permiso para ver la configuración del negocio.</p>
  </SettingSection>
</template>

<script setup lang="ts">
/**
 * Parámetros de negocio (GET/PUT /app-config): cotización del dólar, redondeo de las
 * actualizaciones de abonos y días de aviso de tareas por vencer.
 *
 * Las claves, su etiqueta y su ayuda las declara el BACKEND (`APP_CONFIG_KEYS`): esta
 * pantalla las pinta tal cual vienen, así sumar una clave nueva no obliga a tocar el front.
 */
import { ref, computed, onMounted } from 'vue'
import { businessOutline } from 'ionicons/icons'
import SettingSection from '@/components/settings/SettingSection.vue'
import SettingRow from '@/components/settings/SettingRow.vue'
import api, { apiErrorMessage } from '@/services/api'
import { useToast } from '@/composables/useToast'
import { useMeStore } from '@/stores/me'

interface ClaveConfig { name: string; label: string; description: string; value: string; tipo?: string }

const toast = useToast()
const meStore = useMeStore()

const claves = ref<ClaveConfig[]>([])
const borrador = ref<Record<string, string>>({})
const cargando = ref(true)
const guardando = ref<string | null>(null)

// computed y no valor suelto: el contexto de permisos puede cargar DESPUÉS de montar
// la sección, y un booleano capturado en el setup se quedaría en "solo lectura" para siempre.
const puedeEditar = computed(() => meStore.can('configuracion:update'))

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    const { data } = await api.get('/app-config')
    if (data.success) {
      claves.value = data.data
      borrador.value = Object.fromEntries(data.data.map((c: ClaveConfig) => [c.name, c.value]))
    }
  } catch {
    claves.value = []
  } finally {
    cargando.value = false
  }
}

async function guardar(name: string): Promise<void> {
  guardando.value = name
  try {
    const { data } = await api.put('/app-config', { name, value: borrador.value[name] })
    if (!data.success) { toast.error(data.message); return }
    toast.success('Configuración actualizada')
    await cargar()
  } catch (e) {
    toast.error(apiErrorMessage(e))
    await cargar() // el backend valida rangos: si rechazó, vuelvo al valor real
  } finally {
    guardando.value = null
  }
}

onMounted(() => { void cargar() })
</script>

<style scoped>
.valor-row { display: inline-flex; align-items: center; gap: 8px; }
.valor-input {
  width: 130px; padding: 7px 10px; border-radius: var(--z-r-sm); font-size: 0.85rem;
  font-variant-numeric: tabular-nums; text-align: right;
  border: 1px solid var(--z-border-strong); background: transparent; color: var(--z-text);
}
.valor-input:disabled { opacity: 0.6; }
.action-btn-sm {
  padding: 8px 15px; border-radius: var(--z-r-sm); font-size: 0.82rem; font-weight: 600; cursor: pointer;
  border: 1px solid var(--z-border-strong); background: transparent; color: var(--z-text-soft);
  transition: background var(--z-t-fast), color var(--z-t-fast), border-color var(--z-t-fast);
  display: inline-flex; align-items: center; gap: 6px;
}
.action-btn-sm:hover { background: rgba(148, 163, 184, 0.08); color: var(--z-text); border-color: var(--z-text-dim); }
.action-btn-sm:disabled { opacity: 0.4; cursor: not-allowed; }
.hint-text { font-size: 0.78rem; color: var(--z-text-dim); margin-top: 10px; }
.hint-text code { font-family: ui-monospace, monospace; font-size: 0.95em; }
</style>
