<script setup lang="ts">
/**
 * Panel — qué está pasando ahora, en bloques según capabilities (los calcula el backend,
 * PRD §6.9): cotización del dólar (editable con permiso), contadores de abonos (activos,
 * vencidos y próximos a actualizar), facturación del mes (abonos + proyectos combinados),
 * entregas de proyectos (ventana 5 días) y tareas del equipo.
 *
 * Los gráficos anuales de facturación NO viven acá: tienen su propia pantalla
 * (`EstadisticasPage.vue` → GET /dashboard/estadisticas).
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  createOutline, alertCircleOutline, timeOutline, walletOutline, trendingUpOutline,
  folderOpenOutline, flagOutline, peopleOutline,
} from 'ionicons/icons'
import BanderaPrioridad from '@/components/tareas/BanderaPrioridad.vue'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { duracion, fechaHora } from '@/composables/useFormato'
import api, { apiErrorMessage } from '@/services/api'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { moneda as fmtMoneda, fecha as fmtFecha, MESES } from '@/composables/useFormato'

interface AlertaAbono {
  id: number
  cliente?: string
  servicio?: string
  descripcion?: string | null
  moneda: 'ARS' | 'USD'
  precio: number
  precioPesos: number
  fechaUltimaActualizacion?: string | null
  dias: number
}
interface AlertaProyecto {
  id: number
  nombre: string
  cliente?: string
  estado: string
  fechaEstimadaEntrega: string
  dias: number
}
interface EnProgresoItem {
  id: number
  nombre: string
  prioridad: string
  usuario: string
  espacioId: number
  listaId: number
  espacio: string
  lista: string
  vencida: boolean
  desde: string
}
interface FilaUsuario {
  userId: number
  nombre: string
  activo: boolean
  pendientes: number
  hoy: number
  porVencer: number
  vencidas: number
  enProgreso: number
  pausadas: number
  promedio: { segundos: number; sobre: number } | null
}
interface TareasEquipo {
  tarjetas: (Record<string, number> & { personasConVencidas: number }) | null
  enProgreso: EnProgresoItem[]
  porUsuario: FilaUsuario[]
  dias: number
}
interface DashboardData {
  cotizacion: number
  abonos: { activos: number; totalPesos: number; vencidos: AlertaAbono[]; proximos: AlertaAbono[] } | null
  facturacionMes: {
    anio: number; mes: number
    abonosFacturado?: number; abonosPendiente?: number
    proyectosFacturado?: number; proyectosPendiente?: number
  } | null
  proyectos: { abiertos: number; vencidos: AlertaProyecto[]; proximos: AlertaProyecto[] } | null
  tareasEquipo: TareasEquipo | null
}

const meStore = useMeStore()
const toast = useToast()
const router = useRouter()

const data = ref<DashboardData | null>(null)
const loading = ref(false)

// Modal de cotización (editar + histórico).
const modalCotizacion = ref(false)
const cotizacionInput = ref('')
const historicoCotizacion = ref<Array<{ id: number; valor: number; fecha: string; usuario?: string | null }>>([])
useEscapeToClose(modalCotizacion, () => { modalCotizacion.value = false })
const firstName = computed(() => meStore.user?.name?.split(' ')[0] ?? '')

// Facturación del mes combinada (abonos + proyectos, según permisos).
const factMes = computed(() => {
  const f = data.value?.facturacionMes
  if (!f) return null
  return {
    mes: f.mes,
    facturado: (f.abonosFacturado ?? 0) + (f.proyectosFacturado ?? 0),
    pendiente: (f.abonosPendiente ?? 0) + (f.proyectosPendiente ?? 0),
  }
})

const alertasProyectos = computed(() =>
  data.value?.proyectos ? [...data.value.proyectos.vencidos, ...data.value.proyectos.proximos] : []
)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await api.get('/dashboard')
    if (res.data.success) data.value = res.data.data
  } catch (e) {
    toast.error(apiErrorMessage(e))
  } finally {
    loading.value = false
  }
}

/** Abre el modal de cotización: valor editable (con permiso) + histórico (mejora §10.10). */
async function abrirCotizacion(): Promise<void> {
  cotizacionInput.value = String(data.value?.cotizacion ?? '')
  modalCotizacion.value = true
  try {
    const res = await api.get('/app-config/cotizaciones')
    if (res.data.success) historicoCotizacion.value = res.data.data
  } catch { historicoCotizacion.value = [] }
}

async function guardarCotizacion(): Promise<void> {
  try {
    const res = await api.put('/app-config', { name: 'COTIZACION_DOLAR', value: cotizacionInput.value })
    if (!res.data.success) { toast.error(res.data.message); return }
    toast.success('Cotización actualizada')
    modalCotizacion.value = false
    await load()
  } catch (e) {
    toast.error(apiErrorMessage(e))
  }
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; if (!meStore.loaded) void meStore.loadContext(); void load() })
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

        <header class="flex flex-wrap items-center justify-between gap-3 pb-6">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Hola{{ firstName ? `, ${firstName}` : '' }}</h1>
            <p class="mt-0.5 text-sm text-ink-soft">El estado del negocio, de un vistazo.</p>
          </div>
          <button
            v-if="data"
            class="flex items-center gap-2 px-3 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-2 transition-colors"
            @click="abrirCotizacion()"
          >
            <span class="text-ink-faint text-xs">Dólar</span>
            <span class="tnum font-semibold text-ink">{{ fmtMoneda(data.cotizacion) }}</span>
            <IonIcon v-if="meStore.can('configuracion:update')" :icon="createOutline" class="text-[13px] text-ink-faint" />
          </button>
        </header>

        <!-- Cargando -->
        <div v-if="loading && !data" class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div v-for="i in 4" :key="i" class="ds-skeleton h-20"></div>
        </div>

        <template v-if="data">
          <!-- Tiles -->
          <section v-if="data.abonos" class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/abonos')">
              <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                <IonIcon :icon="walletOutline" class="text-[13px]" /> Abonos activos
              </div>
              <p class="mt-1 text-lg font-semibold tnum text-ink">{{ data.abonos.activos }}</p>
              <p class="text-2xs text-ink-faint tnum">{{ fmtMoneda(data.abonos.totalPesos) }}/mes</p>
            </button>
            <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/abonos?estado=vencido')">
              <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                <IonIcon :icon="alertCircleOutline" class="text-[13px]" /> Por actualizar (vencidos)
              </div>
              <p class="mt-1 text-lg font-semibold tnum" :class="data.abonos.vencidos.length ? 'text-danger' : 'text-ink'">
                {{ data.abonos.vencidos.length }}
              </p>
              <p class="text-2xs text-ink-faint">pasó su período de actualización</p>
            </button>
            <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/abonos?estado=proximo')">
              <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                <IonIcon :icon="timeOutline" class="text-[13px]" /> Próximos (≤ 30 d)
              </div>
              <p class="mt-1 text-lg font-semibold tnum" :class="data.abonos.proximos.length ? 'text-warn' : 'text-ink'">
                {{ data.abonos.proximos.length }}
              </p>
              <p class="text-2xs text-ink-faint">a actualizar este mes</p>
            </button>
            <div v-if="factMes" class="ds-card px-4 py-3">
              <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                <IonIcon :icon="trendingUpOutline" class="text-[13px]" /> {{ MESES[factMes.mes - 1] }}
              </div>
              <p class="mt-1 text-lg font-semibold tnum text-ink">{{ fmtMoneda(factMes.facturado) }}</p>
              <p class="text-2xs text-ink-faint tnum">pendiente {{ fmtMoneda(factMes.pendiente) }}</p>
            </div>
          </section>

          <!-- Tiles de proyectos -->
          <section v-if="data.proyectos" class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/proyectos')">
              <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                <IonIcon :icon="folderOpenOutline" class="text-[13px]" /> Proyectos abiertos
              </div>
              <p class="mt-1 text-lg font-semibold tnum text-ink">{{ data.proyectos.abiertos }}</p>
              <p class="text-2xs text-ink-faint">en diseño, desarrollo o espera</p>
            </button>
            <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/proyectos')">
              <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                <IonIcon :icon="alertCircleOutline" class="text-[13px]" /> Entregas atrasadas
              </div>
              <p class="mt-1 text-lg font-semibold tnum" :class="data.proyectos.vencidos.length ? 'text-danger' : 'text-ink'">
                {{ data.proyectos.vencidos.length }}
              </p>
              <p class="text-2xs text-ink-faint">pasó la fecha estimada</p>
            </button>
            <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/proyectos')">
              <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                <IonIcon :icon="flagOutline" class="text-[13px]" /> Entregas próximas (≤ 5 d)
              </div>
              <p class="mt-1 text-lg font-semibold tnum" :class="data.proyectos.proximos.length ? 'text-warn' : 'text-ink'">
                {{ data.proyectos.proximos.length }}
              </p>
              <p class="text-2xs text-ink-faint">a entregar esta semana</p>
            </button>
            <button v-if="meStore.can('cobranzas:read')" class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/grilla-cobranzas')">
              <div class="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-ink-faint">
                <IonIcon :icon="timeOutline" class="text-[13px]" /> Grilla de cobranzas
              </div>
              <p class="mt-1 text-sm font-medium text-ink">Planificación anual</p>
              <p class="text-2xs text-ink-faint">cuotas por proyecto y mes</p>
            </button>
          </section>

          <!-- Alertas de entrega de proyectos -->
          <section v-if="alertasProyectos.length" class="mb-6">
            <h2 class="text-sm font-semibold text-ink mb-2">Entregas de proyectos</h2>
            <div class="ds-card divide-y divide-line-soft">
              <div v-for="p in alertasProyectos" :key="p.id" class="flex items-center gap-3 px-4 h-row">
                <span :class="p.dias < 0 ? 'ds-badge-danger' : 'ds-badge-warn'" class="shrink-0 w-28 justify-center">
                  {{ p.dias < 0 ? `Atrasado ${Math.abs(p.dias)} d` : (p.dias === 0 ? 'Hoy' : `En ${p.dias} d`) }}
                </span>
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-medium text-ink">{{ p.nombre }}</span>
                  <span class="text-xs text-ink-faint ml-2">{{ p.cliente }}</span>
                </div>
                <span class="hidden lg:block text-2xs text-ink-faint tnum shrink-0 w-32">
                  entrega {{ fmtFecha(p.fechaEstimadaEntrega) }}
                </span>
                <button
                  v-if="meStore.can('proyectos:update')"
                  class="ds-btn-secondary h-7 px-2.5 text-xs shrink-0"
                  @click="router.push(`/proyectos/${p.id}/editar`)"
                >
                  Ver
                </button>
              </div>
            </div>
          </section>

          <!-- Tareas del equipo -->
          <section v-if="data.tareasEquipo?.tarjetas" class="mb-6">
            <h2 class="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
              <IonIcon :icon="peopleOutline" class="text-[15px] text-ink-faint" />
              Tareas del equipo
            </h2>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=pendientes&u=todos')">
                <p class="text-2xs uppercase tracking-wide text-ink-faint">Pendientes</p>
                <p class="mt-1 text-lg font-semibold tnum text-ink">{{ data.tareasEquipo.tarjetas.pendientes }}</p>
                <p class="text-2xs text-ink-faint tnum">{{ data.tareasEquipo.tarjetas.enProgreso }} en progreso · {{ data.tareasEquipo.tarjetas.pausadas }} pausada(s)</p>
              </button>
              <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=hoy&u=todos')">
                <p class="text-2xs uppercase tracking-wide text-ink-faint">Para hoy</p>
                <p class="mt-1 text-lg font-semibold tnum" :class="data.tareasEquipo.tarjetas.hoy ? 'text-warn' : 'text-ink'">{{ data.tareasEquipo.tarjetas.hoy }}</p>
              </button>
              <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=por_vencer&u=todos')">
                <p class="text-2xs uppercase tracking-wide text-ink-faint">Por vencer</p>
                <p class="mt-1 text-lg font-semibold tnum" :class="data.tareasEquipo.tarjetas.porVencer ? 'text-warn' : 'text-ink'">{{ data.tareasEquipo.tarjetas.porVencer }}</p>
                <p class="text-2xs text-ink-faint">próximos {{ data.tareasEquipo.dias }} días</p>
              </button>
              <button class="ds-card px-4 py-3 text-left hover:bg-surface-2/50 transition-colors" @click="router.push('/tareas/resumen?f=vencidas&u=todos')">
                <p class="text-2xs uppercase tracking-wide text-ink-faint">Vencidas</p>
                <p class="mt-1 text-lg font-semibold tnum" :class="data.tareasEquipo.tarjetas.vencidas ? 'text-danger' : 'text-ink'">{{ data.tareasEquipo.tarjetas.vencidas }}</p>
                <p v-if="data.tareasEquipo.tarjetas.vencidas" class="text-2xs text-ink-faint tnum">en {{ data.tareasEquipo.tarjetas.personasConVencidas }} persona(s)</p>
              </button>
            </div>

            <!-- Qué está haciendo cada uno -->
            <div class="grid lg:grid-cols-2 gap-3">
              <div class="ds-card p-4">
                <h3 class="text-xs font-semibold text-ink mb-2">Qué está haciendo cada uno</h3>
                <div v-if="data.tareasEquipo.enProgreso.length" class="space-y-2">
                  <div v-for="t in data.tareasEquipo.enProgreso" :key="t.id" class="flex items-start gap-2">
                    <BanderaPrioridad :prioridad="t.prioridad" :size="13" />
                    <div class="min-w-0 flex-1">
                      <p class="text-xs text-ink">
                        <span class="font-medium">{{ t.usuario }}</span> ·
                        <button class="hover:text-accent underline-offset-2 hover:underline" @click="router.push(`/tareas/espacios/${t.espacioId}/listas/${t.listaId}`)">{{ t.nombre }}</button>
                        <span v-if="t.vencida" class="ds-badge-danger ml-1">vencida</span>
                      </p>
                      <p class="text-2xs text-ink-faint">{{ t.espacio }} · {{ t.lista }} · desde {{ fechaHora(t.desde) }}</p>
                    </div>
                  </div>
                </div>
                <p v-else class="text-xs text-ink-faint py-3">Nadie tiene tareas en progreso ahora mismo.</p>
              </div>

              <!-- Tabla por usuario -->
              <div class="ds-card overflow-x-auto">
                <table class="ds-table">
                  <thead>
                    <tr><th>Persona</th><th>Pend.</th><th>Hoy</th><th>Venc.</th><th>Prom. trabajo</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="u in data.tareasEquipo.porUsuario" :key="u.userId" :class="{ 'opacity-50': !u.activo }">
                      <td class="text-sm" :class="u.userId ? 'text-ink' : 'text-ink-faint italic'">
                        {{ u.userId ? u.nombre : 'Sin responsable' }}{{ u.activo ? '' : ' (inactivo)' }}
                      </td>
                      <td class="tnum text-ink-soft">{{ u.pendientes || '—' }}</td>
                      <td class="tnum" :class="u.hoy ? 'text-warn' : 'text-ink-faint'">{{ u.hoy || '—' }}</td>
                      <td class="tnum" :class="u.vencidas ? 'text-danger font-medium' : 'text-ink-faint'">{{ u.vencidas || '—' }}</td>
                      <td class="text-2xs text-ink-soft tnum">
                        {{ u.promedio ? `${duracion(u.promedio.segundos)} · ${u.promedio.sobre} tarea(s)` : 'sin datos' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p class="px-3 py-2 text-2xs text-ink-faint border-t border-line-soft">
                  Promedio: desde «en progreso» hasta revisión/completada, descontando pausas.
                </p>
              </div>
            </div>
          </section>

          <!-- Sin permisos de ningún bloque -->
          <div v-if="!data.abonos && !data.facturacionMes && !data.proyectos" class="ds-card px-6 py-10 text-center">
            <p class="text-sm font-medium text-ink">El panel no tiene nada para mostrarte con los permisos de tu rol.</p>
            <p class="text-xs text-ink-faint mt-1">Elegí una opción del menú para empezar.</p>
          </div>
        </template>
      </div>

      <!-- Modal cotización: editar + histórico -->
      <Teleport defer to="ion-app">
        <div v-if="modalCotizacion" class="ds-modal-backdrop" @click.self="modalCotizacion = false">
          <div class="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-label="Cotización del dólar">
            <h2 class="text-base font-semibold text-ink mb-1">Cotización del dólar</h2>
            <p class="text-xs text-ink-soft mb-3">Impacta en abonos USD, cuotas de proyectos y montos pendientes.</p>
            <form v-if="meStore.can('configuracion:update')" class="flex items-end gap-2 mb-4" @submit.prevent="guardarCotizacion">
              <div class="flex-1">
                <label class="ds-label" for="cot-valor">Valor</label>
                <input id="cot-valor" v-model="cotizacionInput" class="ds-input font-mono" type="number" min="1" step="0.01" />
              </div>
              <button type="submit" class="ds-btn-primary">Guardar</button>
            </form>
            <div>
              <p class="ds-label !mb-1">Histórico</p>
              <div v-if="historicoCotizacion.length" class="border border-line rounded-lg divide-y divide-line-soft max-h-56 overflow-y-auto">
                <div v-for="h in historicoCotizacion" :key="h.id" class="flex items-center gap-3 px-3 h-9 text-xs">
                  <span class="tnum font-medium text-ink">{{ fmtMoneda(h.valor) }}</span>
                  <span class="flex-1 text-ink-faint truncate">{{ h.usuario ?? '—' }}</span>
                  <span class="text-ink-faint tnum">{{ fechaHora(h.fecha) }}</span>
                </div>
              </div>
              <p v-else class="text-2xs text-ink-faint">Sin cambios registrados todavía.</p>
            </div>
            <footer class="flex justify-end pt-3">
              <button type="button" class="ds-btn-secondary" @click="modalCotizacion = false">Cerrar</button>
            </footer>
          </div>
        </div>
      </Teleport>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
</style>
