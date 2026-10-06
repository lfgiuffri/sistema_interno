<script setup lang="ts">
/**
 * Ejecuciones de FullGlass: el historial de todo el SQL que se corrió sobre las bases de los
 * clientes y de todos los deploys, y el lugar donde se APRUEBA seguir después del canario.
 *
 * El historial es la mitad del valor de esta función. El script PHP que esto reemplaza
 * anotaba la query en un `.txt` y nada más: si fallaba en el sitio 12 de 30, el registro decía
 * igual que se había corrido. Acá cada base deja su fila, con filas afectadas o el error
 * textual, y se puede responder «qué le corrimos a este cliente en marzo».
 *
 * Se refresca sola cada 5 s mientras haya algo en curso: un trabajo lanzado tarda lo que tarde
 * el agente en tomarlo, y mirar una pantalla que no se mueve hace creer que se colgó.
 */
import { ref, computed, onUnmounted } from 'vue'
import {
  onIonViewWillEnter, onIonViewWillLeave, IonPage, IonContent, IonHeader, IonToolbar,
  IonButtons, IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import { refreshOutline, checkmarkCircleOutline, closeCircleOutline, chevronDownOutline } from 'ionicons/icons'
import { useMantenimientoStore, type Trabajo } from '@/stores/mantenimiento'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { fechaHora as fmtFechaHora } from '@/composables/useFormato'

const store = useMantenimientoStore()
const meStore = useMeStore()
const toast = useToast()

const filas = ref<Trabajo[]>([])
const cargando = ref(false)
const abierto = ref<number | null>(null)
const detalles = ref<Record<number, Trabajo>>({})
const filtroTipo = ref('')

/** Cómo se pinta cada estado y qué dice. */
const ESTADO: Record<string, { label: string; clase: string }> = {
  pendiente: { label: 'Esperando al agente', clase: 'ds-badge-neutral' },
  canario: { label: 'Probando en 1 base', clase: 'ds-badge-warn' },
  espera_ok: { label: 'Esperando tu OK', clase: 'ds-badge-warn' },
  aprobado: { label: 'Aprobado', clase: 'ds-badge-neutral' },
  corriendo: { label: 'Corriendo', clase: 'ds-badge-warn' },
  ok: { label: 'Listo', clase: 'ds-badge-ok' },
  error: { label: 'Con errores', clase: 'ds-badge-danger' },
  cancelado: { label: 'Cancelado', clase: 'ds-badge-neutral' },
}

const EN_CURSO = ['pendiente', 'canario', 'espera_ok', 'aprobado', 'corriendo']
const hayEnCurso = computed(() => filas.value.some(t => EN_CURSO.includes(t.estado)))

async function load(): Promise<void> {
  cargando.value = true
  filas.value = await store.fetchTrabajos(filtroTipo.value ? { tipo: filtroTipo.value } : {})
  cargando.value = false
  // El detalle abierto se recarga también: si no, aprobar no cambiaría nada en pantalla.
  if (abierto.value) detalles.value[abierto.value] = (await store.fetchTrabajo(abierto.value))!
}

let timer: number | undefined
function autoRefrescar(): void {
  window.clearInterval(timer)
  timer = window.setInterval(() => { if (hayEnCurso.value) void load() }, 5000)
}
onIonViewWillEnter(() => { void load(); autoRefrescar() })
onIonViewWillLeave(() => window.clearInterval(timer))
onUnmounted(() => window.clearInterval(timer))

async function abrir(t: Trabajo): Promise<void> {
  if (abierto.value === t.id) { abierto.value = null; return }
  abierto.value = t.id
  const d = await store.fetchTrabajo(t.id)
  if (d) detalles.value = { ...detalles.value, [t.id]: d }
}

/** Aprobar es decidir que el SQL se aplique a TODAS las bases: se pregunta de nuevo. */
async function aprobar(t: Trabajo): Promise<void> {
  const d = detalles.value[t.id]
  const canario = d?.resultados?.find(r => r.esCanario)
  const alert = await alertController.create({
    backdropDismiss: false,
    header: 'Aplicar al resto de las bases',
    message: `La prueba en ${canario?.base ?? 'una base'} terminó bien. ¿Aplicar el mismo SQL a todas las demás bases de ${t.servidore?.nombre ?? 'este servidor'}?`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Aplicar a todas', role: 'confirm' },
    ],
  })
  await alert.present()
  if ((await alert.onDidDismiss()).role !== 'confirm') return

  const r = await store.aprobarTrabajo(t.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Aprobado: el agente lo va a tomar en unos segundos')
  await load()
}

async function cancelar(t: Trabajo): Promise<void> {
  const r = await store.cancelarTrabajo(t.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Trabajo cancelado')
  await load()
}

const puedeAprobar = (t: Trabajo) =>
  t.tipo === 'sql' ? meStore.can('servidores:bd-ejecutar') : meStore.can('servidores:deploy-ejecutar')
</script>

<template>
  <IonPage>
    <IonHeader class="ion-no-border">
      <IonToolbar class="app-toolbar"><IonButtons slot="start"><IonMenuButton /></IonButtons></IonToolbar>
    </IonHeader>

    <IonContent class="page-content">
      <div class="px-4 pb-10 pt-1 max-w-5xl mx-auto overflow-x-hidden">
        <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="text-lg font-semibold text-ink">Ejecuciones en servidores</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              Todo el SQL que se corrió sobre las bases de los clientes y todos los deploys.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select v-model="filtroTipo" class="ds-input h-9 w-44" @change="load">
              <option value="">Todo</option>
              <option value="sql">Bases de datos</option>
              <option value="deploy">Deploys</option>
            </select>
            <button class="ds-btn-secondary" :disabled="cargando" @click="load">
              <IonIcon :icon="refreshOutline" class="text-[15px]" /> Actualizar
            </button>
          </div>
        </header>

        <div v-if="cargando && !filas.length" class="space-y-2">
          <div v-for="i in 4" :key="i" class="ds-skeleton h-16"></div>
        </div>

        <p v-else-if="!filas.length" class="ds-card p-6 text-center text-sm text-ink-soft">
          Todavía no se ejecutó nada en los servidores.
        </p>

        <div v-else class="space-y-2">
          <article v-for="t in filas" :key="t.id" class="ds-card overflow-hidden">
            <div class="px-4 py-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <button class="min-w-0 flex-1 text-left" @click="abrir(t)">
                  <p class="font-medium text-ink">
                    {{ t.tipo === 'sql' ? 'Actualización de bases' : `Deploy de ${t.entorno}` }}
                    <span class="text-ink-faint">· {{ t.servidore?.nombre ?? `servidor #${t.servidorId}` }}</span>
                  </p>
                  <p class="mt-0.5 text-2xs text-ink-faint">
                    {{ fmtFechaHora(t.createdAt) }}
                    <span v-if="t.user"> · {{ t.user.name }} {{ t.user.lastName }}</span>
                    <IonIcon :icon="chevronDownOutline" class="text-[13px] ml-1 transition-transform"
                             :class="{ 'rotate-180': abierto === t.id }" />
                  </p>
                </button>
                <div class="flex items-center gap-2 shrink-0">
                  <span :class="ESTADO[t.estado]?.clase ?? 'ds-badge-neutral'">
                    {{ ESTADO[t.estado]?.label ?? t.estado }}
                  </span>
                  <!-- Aprobar es el paso que hace que el SQL llegue a todas las bases. -->
                  <button
                    v-if="t.estado === 'espera_ok' && puedeAprobar(t)"
                    class="ds-btn-primary h-7 px-2.5 text-xs" @click="aprobar(t)"
                  >
                    <IonIcon :icon="checkmarkCircleOutline" class="text-[14px]" /> Aplicar al resto
                  </button>
                  <button
                    v-if="['pendiente', 'espera_ok', 'aprobado', 'canario', 'corriendo'].includes(t.estado) && puedeAprobar(t)"
                    class="ds-btn-secondary h-7 px-2.5 text-xs" @click="cancelar(t)"
                  >
                    <IonIcon :icon="closeCircleOutline" class="text-[14px]" /> Cancelar
                  </button>
                </div>
              </div>
              <p v-if="t.error" class="mt-1 text-2xs text-danger">{{ t.error }}</p>
            </div>

            <div v-if="abierto === t.id" class="px-4 pb-4 border-t border-line-soft pt-3">
              <pre v-if="detalles[t.id]?.sql" class="text-2xs font-mono bg-surface-2 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{{ detalles[t.id].sql }}</pre>
              <pre v-if="detalles[t.id]?.comando" class="text-2xs font-mono bg-surface-2 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{{ detalles[t.id].comando }}</pre>

              <!-- Resultado base por base: lo que el script viejo no guardaba. -->
              <div v-if="detalles[t.id]?.resultados?.length" class="mt-3 overflow-x-auto">
                <table class="ds-table min-w-[560px]">
                  <thead>
                    <tr><th>Base</th><th>Sitio</th><th class="text-right">Filas</th><th>Resultado</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in detalles[t.id].resultados" :key="r.id">
                      <td class="text-ink">
                        {{ r.base ?? '—' }}
                        <span v-if="r.esCanario" class="ds-badge-neutral ml-1">prueba</span>
                      </td>
                      <td class="text-ink-faint text-2xs">{{ r.sitio }}</td>
                      <td class="text-right tnum text-ink-soft">{{ r.filasAfectadas ?? '—' }}</td>
                      <td>
                        <span v-if="r.estado === 'ok'" class="ds-badge-ok">ok</span>
                        <span v-else-if="r.estado === 'omitido'" class="ds-badge-warn">omitido</span>
                        <span v-else class="ds-badge-danger">error</span>
                        <span v-if="r.error" class="block text-2xs text-danger break-words">{{ r.error }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="detalles[t.id]?.salida" class="mt-3">
                <p class="text-2xs font-medium uppercase tracking-wide text-ink-faint mb-1">Salida</p>
                <pre class="text-2xs font-mono bg-surface-2 rounded p-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{{ detalles[t.id].salida }}</pre>
              </div>
            </div>
          </article>
        </div>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
</style>
