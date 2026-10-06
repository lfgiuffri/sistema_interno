<script setup lang="ts">
/**
 * Lanzar un trabajo de FullGlass (SQL masivo o deploy) sobre uno o varios servidores.
 *
 * Es la pantalla más peligrosa del sistema: lo que se apriete acá corre en producción de los
 * clientes. Todo el diseño está puesto en que sea IMPOSIBLE hacerlo de taquito:
 *
 *  - Se listan por nombre los servidores alcanzados, y las bases de cada uno, ANTES de lanzar.
 *  - El SQL se analiza mientras se escribe: si hay algo catastrófico (DROP, TRUNCATE, un
 *    UPDATE sin WHERE) aparece un cartel rojo y hay que escribir CONFIRMO.
 *  - El SQL NO se aplica a todo: corre primero en UNA base por servidor y espera aprobación.
 *    Eso se dice en el botón, no en una ayuda al pie.
 *  - El deploy muestra el comando EXACTO que se va a ejecutar, por servidor: configurar y
 *    ejecutar son permisos distintos, así que quien aprieta puede no ser quien lo escribió.
 */
import { ref, computed, watch } from 'vue'
import { IonIcon } from '@ionic/vue'
import { warningOutline, serverOutline } from 'ionicons/icons'
import { useMantenimientoStore, type Servidor, type SitioServidor, type AnalisisSql } from '@/stores/mantenimiento'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fechaHora as fmtFechaHora } from '@/composables/useFormato'

const props = defineProps<{
  open: boolean
  /** Servidores alcanzados. Ya vienen filtrados por `tieneFullglass`. */
  servidores: Servidor[]
  /** Qué se va a lanzar. */
  tipo: 'sql' | 'deploy'
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'lanzado'): void }>()

const store = useMantenimientoStore()
const toast = useToast()

const sql = ref('')
const entorno = ref<'produccion' | 'desarrollo'>('produccion')
const confirmacion = ref('')
const analisis = ref<AnalisisSql | null>(null)
const sitiosPorServidor = ref<Record<number, SitioServidor[]>>({})
/** Rutas destildadas: se excluyen del lanzamiento. */
const excluidos = ref<Set<string>>(new Set())
const lanzando = ref(false)
const error = ref('')

const abierto = computed(() => props.open)
useEscapeToClose(abierto, () => emit('close'))

const hayPeligro = computed(() => (analisis.value?.peligros.length ?? 0) > 0)
const confirmado = computed(() => confirmacion.value.trim().toUpperCase() === 'CONFIRMO')

/** Bases que efectivamente se van a tocar, ya descontando las destildadas. */
const basesElegidas = computed(() => {
  const out: Record<number, SitioServidor[]> = {}
  for (const s of props.servidores) {
    out[s.id] = (sitiosPorServidor.value[s.id] ?? [])
      .filter(x => x.base && !excluidos.value.has(x.ruta))
  }
  return out
})
const totalBases = computed(() => Object.values(basesElegidas.value).reduce((a, b) => a + b.length, 0))

/** Servidores a los que les falta el comando del entorno elegido: no se puede lanzar. */
const sinComando = computed(() => props.servidores.filter(s =>
  entorno.value === 'produccion' ? !s.comandoDeployProd : !s.comandoDeployDev))

const puedeLanzar = computed(() => {
  if (lanzando.value) return false
  if (props.tipo === 'deploy') return props.servidores.length > 0 && sinComando.value.length === 0
  return !!sql.value.trim() && totalBases.value > 0 && (!hayPeligro.value || confirmado.value)
})

watch(() => props.open, async (v) => {
  if (!v) return
  sql.value = ''
  confirmacion.value = ''
  analisis.value = null
  error.value = ''
  excluidos.value = new Set()
  sitiosPorServidor.value = {}
  if (props.tipo !== 'sql') return
  // La vista previa de bases: sin esto se lanza a ciegas sobre cuántos clientes se toca.
  for (const s of props.servidores) {
    sitiosPorServidor.value = { ...sitiosPorServidor.value, [s.id]: await store.fetchSitiosServidor(s.id) }
  }
})

let debounce: number | undefined
watch(sql, (v) => {
  window.clearTimeout(debounce)
  if (!v.trim()) { analisis.value = null; return }
  // Se analiza con pausa: es una llamada por tecleo si no.
  debounce = window.setTimeout(async () => { analisis.value = await store.analizarSql(v) }, 400)
})

function alternar(ruta: string): void {
  const s = new Set(excluidos.value)
  if (s.has(ruta)) s.delete(ruta); else s.add(ruta)
  excluidos.value = s
}

async function lanzar(): Promise<void> {
  if (!puedeLanzar.value) return
  lanzando.value = true
  error.value = ''

  // Se manda la selección SOLO si se destildó algo: `null` significa «todas las que encuentre
  // el agente», que es más robusto que congelar una lista que puede haber cambiado.
  const r = await store.lanzarTrabajos({
    tipo: props.tipo,
    servidorIds: props.servidores.map(s => s.id),
    ...(props.tipo === 'sql'
      ? {
        sql: sql.value,
        ...(excluidos.value.size
          ? { sitios: Object.values(basesElegidas.value).flat().map(x => x.ruta) }
          : {}),
        ...(hayPeligro.value ? { confirmacion: confirmacion.value.trim().toUpperCase() } : {}),
      }
      : { entorno: entorno.value }),
  })
  lanzando.value = false
  if (!r.ok) { error.value = r.message; return }

  toast.success(props.tipo === 'sql'
    ? 'Lanzado: corre primero en una base por servidor y espera tu aprobación'
    : 'Deploy lanzado')
  emit('lanzado')
  emit('close')
}
</script>

<template>
  <Teleport defer to="ion-app">
    <div v-if="open" class="ds-modal-backdrop">
      <div class="ds-modal ds-modal-xl" role="dialog" aria-modal="true"
           :aria-label="tipo === 'sql' ? 'Actualizar bases de datos' : 'Deploy de FullGlass'">
        <header class="mb-3">
          <h2 class="text-base font-semibold text-ink">
            {{ tipo === 'sql' ? 'Actualizar bases de datos' : 'Deploy de FullGlass' }}
          </h2>
          <p class="text-2xs text-ink-faint">
            {{ servidores.length }} servidor(es)<span v-if="tipo === 'sql'"> · {{ totalBases }} base(s)</span>
          </p>
        </header>

        <!-- A quién le pega. Va arriba de todo y con nombre propio: es lo primero que hay
             que poder verificar antes de apretar. -->
        <div class="ds-card p-3 mb-3">
          <p class="text-2xs font-medium uppercase tracking-wide text-ink-faint mb-1.5">Se va a ejecutar en</p>
          <ul class="space-y-1">
            <li v-for="s in servidores" :key="s.id" class="flex items-start gap-2 text-sm">
              <IonIcon :icon="serverOutline" class="text-[14px] text-ink-faint mt-0.5 shrink-0" />
              <span class="min-w-0">
                <span class="font-medium text-ink">{{ s.nombre }}</span>
                <span class="text-ink-faint"> · {{ s.ip }}</span>
                <span v-if="s.estado !== 'online'" class="ds-badge-warn ml-1">sin contacto</span>
                <span v-if="tipo === 'sql'" class="block text-2xs text-ink-faint tnum">
                  {{ (basesElegidas[s.id] ?? []).length }} base(s)
                </span>
                <code v-else class="block text-2xs text-ink-soft break-all">
                  {{ (entorno === 'produccion' ? s.comandoDeployProd : s.comandoDeployDev) || '— sin comando configurado —' }}
                </code>
              </span>
            </li>
          </ul>
        </div>

        <!-- ── Deploy ── -->
        <template v-if="tipo === 'deploy'">
          <div class="mb-3">
            <span class="ds-label">Entorno</span>
            <div class="flex gap-1.5">
              <button
                v-for="e in (['produccion', 'desarrollo'] as const)" :key="e" type="button"
                class="ds-pill" :class="{ 'ds-pill-activa': entorno === e }"
                :style="{ '--c': e === 'produccion' ? '#b45309' : '#2563eb' }"
                @click="entorno = e"
              >{{ e === 'produccion' ? 'Producción' : 'Desarrollo' }}</button>
            </div>
          </div>
          <p v-if="sinComando.length" class="ds-error" role="alert">
            Sin comando de {{ entorno }} configurado en: {{ sinComando.map(s => s.nombre).join(', ') }}.
          </p>
        </template>

        <!-- ── SQL ── -->
        <template v-else>
          <div class="mb-3">
            <label class="ds-label" for="fg-sql">Consultas</label>
            <textarea
              id="fg-sql" v-model="sql" rows="7" spellcheck="false"
              class="ds-input !h-auto py-2 font-mono text-xs"
              placeholder="ALTER TABLE pedidos ADD COLUMN descuento INT DEFAULT 0;"
            ></textarea>
            <p class="ds-hint">
              Varias sentencias separadas por «;». Se ejecutan en cada base de cada servidor.
            </p>
          </div>

          <!-- El aviso de lo catastrófico. Rojo, con la sentencia textual y una palabra que
               hay que escribir: el objetivo es que no se pueda pasar sin leerlo. -->
          <div v-if="hayPeligro" class="ds-card p-3 mb-3 border-danger bg-danger-soft">
            <p class="flex items-center gap-1.5 text-sm font-semibold text-danger">
              <IonIcon :icon="warningOutline" class="text-[16px]" /> Esto puede destruir datos
            </p>
            <ul class="mt-1.5 space-y-1">
              <li v-for="(p, i) in analisis?.peligros ?? []" :key="i" class="text-2xs text-ink-soft">
                <strong class="text-danger">{{ p.que }}</strong> — <code class="break-all">{{ p.sentencia }}</code>
              </li>
            </ul>
            <p class="mt-2 text-2xs text-ink-soft">
              Un <code>ALTER</code> o un <code>DROP</code> no se pueden deshacer. Escribí
              <strong>CONFIRMO</strong> para habilitar el botón.
            </p>
            <input v-model="confirmacion" class="ds-input h-8 mt-1.5 max-w-[180px]" placeholder="CONFIRMO" />
          </div>

          <!-- Vista previa de bases, con la posibilidad de sacar alguna. -->
          <div v-if="totalBases || Object.keys(sitiosPorServidor).length" class="mb-3">
            <p class="text-2xs font-medium uppercase tracking-wide text-ink-faint mb-1.5">
              Bases alcanzadas ({{ totalBases }})
            </p>
            <div class="ds-card p-2 max-h-44 overflow-y-auto space-y-2">
              <div v-for="s in servidores" :key="s.id">
                <p class="text-2xs text-ink-faint">{{ s.nombre }}</p>
                <!-- Dos causas distintas que antes decían lo mismo y mandaban a buscar el
                     problema a lugares opuestos. -->
                <p v-if="!(sitiosPorServidor[s.id] ?? []).length" class="text-2xs text-ink-faint italic">
                  <template v-if="s.sitiosReportadosAt">
                    El agente recorrió «{{ s.rutaSitios }}» y no encontró ningún sitio
                    ({{ fmtFechaHora(s.sitiosReportadosAt) }}). Revisá la ruta en «Configurar».
                  </template>
                  <template v-else>
                    El agente nunca reportó sus sitios. Lo más probable es que al servidor le
                    falte el worker de FullGlass: volvé a correr el instalador del agente ahí
                    (lo detecta solo porque el servidor está marcado como que lo aloja).
                  </template>
                </p>
                <label
                  v-for="x in sitiosPorServidor[s.id] ?? []" :key="x.ruta"
                  class="flex items-center gap-2 text-xs py-0.5"
                  :class="{ 'opacity-50': !x.base }"
                >
                  <input
                    type="checkbox" class="accent-accent" :disabled="!x.base"
                    :checked="!!x.base && !excluidos.has(x.ruta)" @change="alternar(x.ruta)"
                  />
                  <span class="text-ink">{{ x.base ?? '—' }}</span>
                  <span class="text-ink-faint truncate">{{ x.ruta }}</span>
                  <span v-if="x.problema" class="ds-badge-warn">{{ x.problema }}</span>
                </label>
              </div>
            </div>
          </div>
        </template>

        <p v-if="error" class="ds-error" role="alert">{{ error }}</p>

        <footer class="flex justify-end gap-2 pt-1">
          <button type="button" class="ds-btn-secondary" @click="emit('close')">Cancelar</button>
          <button type="button" class="ds-btn-danger" :disabled="!puedeLanzar" @click="lanzar">
            <template v-if="lanzando">Lanzando…</template>
            <!-- El botón dice lo que REALMENTE va a pasar: el SQL no se aplica a todo. -->
            <template v-else-if="tipo === 'sql'">Probar en 1 base por servidor</template>
            <template v-else>Ejecutar deploy de {{ entorno }}</template>
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
