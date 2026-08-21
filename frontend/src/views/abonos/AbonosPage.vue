<script setup lang="ts">
/**
 * Abonos — pantalla central del módulo comercial.
 * Tiles de resumen, filtros, tabla con selección múltiple (solo activos) y las
 * acciones masivas Actualizar precios / Facturar (modales de dos pasos).
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  addOutline, searchOutline, createOutline, trashOutline, powerOutline,
  trendingUpOutline, receiptOutline, walletOutline, downloadOutline,
} from 'ionicons/icons'
import { descargarCsv } from '@/composables/useCsv'
import { useAbonosStore, type Abono, type AbonoFiltros } from '@/stores/abonos'
import CotizacionDolar from '@/components/shared/CotizacionDolar.vue'
import ThOrdenable from '@/components/shared/ThOrdenable.vue'
import { useOrdenRemoto } from '@/composables/useOrdenTabla'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { moneda as fmtMoneda, fecha as fmtFecha } from '@/composables/useFormato'
import ActualizarPreciosModal from './ActualizarPreciosModal.vue'
import FacturarModal from './FacturarModal.vue'

const abonosStore = useAbonosStore()
const meStore = useMeStore()
const toast = useToast()
const router = useRouter()

const filtros = ref<AbonoFiltros>({ estado: '', moneda: '', activo: '', search: '' })
const page = ref(1)
let searchTimer: ReturnType<typeof setTimeout> | null = null

const seleccion = ref<Set<number>>(new Set())
const modalActualizar = ref(false)
const modalFacturar = ref(false)

const idsSeleccionados = computed(() => [...seleccion.value])
const seleccionados = computed(() => abonosStore.rows.filter(a => seleccion.value.has(a.id)))
const hayArs = computed(() => seleccionados.value.some(a => a.moneda === 'ARS'))
const hayUsd = computed(() => seleccionados.value.some(a => a.moneda === 'USD'))
const activos = computed(() => abonosStore.rows.filter(a => a.activo))
const todosSeleccionados = computed(() =>
  activos.value.length > 0 && activos.value.every(a => seleccion.value.has(a.id))
)

// El orden lo resuelve el SERVIDOR: son 76 abonos en páginas de 50, así que ordenar en el
// navegador ordenaría media tabla. Cambiar de columna vuelve a la página 1.
const orden = useOrdenRemoto(() => { page.value = 1; void load() })

async function load(): Promise<void> {
  await abonosStore.fetchAll({ ...filtros.value, ...orden.params.value }, page.value)
  // Depurar selección: ids que ya no están en la página.
  const visibles = new Set(abonosStore.rows.map(a => a.id))
  seleccion.value = new Set([...seleccion.value].filter(id => visibles.has(id)))
}

function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; void load() }, 250)
}

function onFiltro(): void { page.value = 1; void load() }

function toggleSeleccion(abono: Abono): void {
  if (!abono.activo) return
  const next = new Set(seleccion.value)
  if (next.has(abono.id)) next.delete(abono.id)
  else next.add(abono.id)
  seleccion.value = next
}

function toggleTodos(): void {
  seleccion.value = todosSeleccionados.value ? new Set() : new Set(activos.value.map(a => a.id))
}

async function toggle(abono: Abono): Promise<void> {
  const r = await abonosStore.toggleActive(abono.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success(r.abono?.activo ? 'Abono activado' : 'Abono desactivado')
  await load()
}

async function confirmDelete(abono: Abono): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar abono',
    message: `¿Eliminar el abono de ${abono.cliente?.nombre} (${abono.servicio?.nombre})? El histórico de facturaciones se conserva.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await abonosStore.remove(abono.id)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Abono eliminado')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

/** Badge de estado de actualización según los días calculados. */
function estadoActualizacion(abono: Abono): { clase: string; texto: string } | null {
  const dias = abono.diasParaActualizar
  if (dias === null || dias === undefined) return null
  if (dias < 0) return { clase: 'ds-badge-danger', texto: `Vencido hace ${Math.abs(dias)} d` }
  if (dias <= 30) return { clase: 'ds-badge-warn', texto: `En ${dias} d` }
  return null
}

/** Export CSV de la página actual del listado (mejora §10.8). */
function exportarCsv(): void {
  descargarCsv('abonos',
    ['Cliente', 'Servicio', 'Descripción', 'Moneda', 'Precio', 'Inicio', 'Período (meses)', 'Próx. actualización', 'Activo'],
    abonosStore.rows.map(a => [
      a.cliente?.nombre, a.servicio?.nombre, a.descripcion ?? '', a.moneda, a.precio,
      a.fechaInicio, a.periodoMeses, a.proximaActualizacion ?? '', a.activo ? 'Sí' : 'No',
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

        <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Abonos</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Servicios recurrentes: precios, actualizaciones y facturación mensual.</p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
          <!-- La cotización se edita acá mismo: es donde se nota que está vieja (los precios
               USD se muestran convertidos a pesos con este valor). -->
          <CotizacionDolar
            v-if="abonosStore.resumen"
            :valor="abonosStore.resumen.cotizacion"
            @actualizada="load()"
          />
          <button class="ds-btn-secondary" title="Exportar CSV" @click="exportarCsv">
            <IonIcon :icon="downloadOutline" class="text-[15px]" />
            CSV
          </button>
          <button v-if="meStore.can('abonos:create')" class="ds-btn-primary" @click="router.push('/abonos/nuevo')">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nuevo abono
          </button>
          </div>
        </header>

        <!-- Tiles de resumen -->
        <section v-if="abonosStore.resumen" class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div class="ds-card px-4 py-3">
            <p class="text-2xs uppercase tracking-wide text-ink-faint">Abonos activos</p>
            <p class="mt-1 text-lg font-semibold tnum text-ink">{{ abonosStore.resumen.activos }}</p>
          </div>
          <div class="ds-card px-4 py-3">
            <p class="text-2xs uppercase tracking-wide text-ink-faint">Total mensual</p>
            <p class="mt-1 text-lg font-semibold tnum text-ink">{{ fmtMoneda(abonosStore.resumen.totalPesos) }}</p>
          </div>
          <div class="ds-card px-4 py-3">
            <p class="text-2xs uppercase tracking-wide text-ink-faint">Próximos a actualizar</p>
            <p class="mt-1 text-lg font-semibold tnum" :class="abonosStore.resumen.proximos ? 'text-warn' : 'text-ink'">{{ abonosStore.resumen.proximos }}</p>
          </div>
          <div class="ds-card px-4 py-3">
            <p class="text-2xs uppercase tracking-wide text-ink-faint">Vencidos</p>
            <p class="mt-1 text-lg font-semibold tnum" :class="abonosStore.resumen.vencidos ? 'text-danger' : 'text-ink'">{{ abonosStore.resumen.vencidos }}</p>
          </div>
        </section>

        <!-- Filtros -->
        <div class="flex flex-wrap items-end gap-3 mb-4">
          <div class="relative w-56">
            <IonIcon :icon="searchOutline" class="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint pointer-events-none" />
            <input v-model="filtros.search" class="ds-input h-9 pl-9" type="search" placeholder="Buscar por descripción o cliente…" @input="onSearch" />
          </div>
          <select v-model="filtros.estado" class="ds-input h-9 w-44" @change="onFiltro">
            <option value="">Estado: todos</option>
            <option value="vencido">Vencidos</option>
            <option value="proximo">Próximos (≤ 30 d)</option>
            <option value="aldia">Al día</option>
          </select>
          <select v-model="filtros.moneda" class="ds-input h-9 w-36" @change="onFiltro">
            <option value="">Moneda: todas</option>
            <option value="ARS">Pesos</option>
            <option value="USD">Dólares</option>
          </select>
          <select v-model="filtros.activo" class="ds-input h-9 w-36" @change="onFiltro">
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </div>

        <!-- Barra de selección múltiple -->
        <div v-if="seleccion.size > 0" class="flex items-center gap-3 mb-3 px-4 h-11 rounded-lg bg-accent-soft border border-accent/20 ds-enter">
          <span class="text-sm font-medium text-accent-ink tnum">{{ seleccion.size }} seleccionado(s)</span>
          <div class="flex-1"></div>
          <button v-if="meStore.can('abonos:actualizar-precio')" class="ds-btn-secondary h-8" @click="modalActualizar = true">
            <IonIcon :icon="trendingUpOutline" class="text-[15px]" />
            Actualizar precios
          </button>
          <button v-if="meStore.can('abonos:facturar')" class="ds-btn-primary h-8" @click="modalFacturar = true">
            <IonIcon :icon="receiptOutline" class="text-[15px]" />
            Facturar
          </button>
        </div>

        <!-- Tabla -->
        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th class="w-10">
                  <input type="checkbox" :checked="todosSeleccionados" class="accent-[#0F7660]" aria-label="Seleccionar todos" @change="toggleTodos" />
                </th>
                <ThOrdenable columna="cliente" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Cliente / Servicio</ThOrdenable>
                <ThOrdenable columna="precio" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Precio</ThOrdenable>
                <ThOrdenable columna="proximaActualizacion" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Próx. actualización</ThOrdenable>
                <ThOrdenable columna="activo" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Estado</ThOrdenable>
                <th class="w-24"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="abonosStore.loading && !abonosStore.rows.length">
              <tr v-for="i in 5" :key="i"><td colspan="6" class="!px-3"><div class="ds-skeleton h-5 w-full my-2"></div></td></tr>
            </tbody>

            <tbody v-else-if="abonosStore.rows.length">
              <tr v-for="abono in abonosStore.rows" :key="abono.id" :class="{ 'opacity-50': !abono.activo }">
                <td>
                  <input
                    type="checkbox"
                    class="accent-[#0F7660]"
                    :checked="seleccion.has(abono.id)"
                    :disabled="!abono.activo"
                    :title="abono.activo ? '' : 'Abono inactivo: no se puede seleccionar'"
                    aria-label="Seleccionar abono"
                    @change="toggleSeleccion(abono)"
                  />
                </td>
                <td>
                  <p class="font-medium text-ink">{{ abono.cliente?.nombre }}</p>
                  <p class="text-2xs text-ink-faint">{{ abono.servicio?.nombre }}{{ abono.descripcion ? ` · ${abono.descripcion}` : '' }}</p>
                </td>
                <td>
                  <div class="flex items-center gap-1.5">
                    <span class="ds-badge-neutral !h-[18px] !text-2xs font-mono">{{ abono.moneda }}</span>
                    <span class="tnum font-medium text-ink">{{ fmtMoneda(abono.precio, abono.moneda) }}</span>
                  </div>
                </td>
                <td>
                  <div class="flex items-center gap-2">
                    <span class="text-ink-soft tnum">{{ fmtFecha(abono.proximaActualizacion) }}</span>
                    <span v-if="abono.activo && estadoActualizacion(abono)" :class="estadoActualizacion(abono)!.clase">
                      {{ estadoActualizacion(abono)!.texto }}
                    </span>
                  </div>
                </td>
                <td>
                  <span :class="abono.activo ? 'ds-badge-ok' : 'ds-badge-neutral'">
                    <span class="w-1.5 h-1.5 rounded-full" :class="abono.activo ? 'bg-ok' : 'bg-ink-faint'"></span>
                    {{ abono.activo ? 'Activo' : 'Inactivo' }}
                  </span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <button v-if="meStore.can('abonos:update')" class="row-action" title="Editar" aria-label="Editar" @click="router.push(`/abonos/${abono.id}/editar`)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('abonos:toggle')" class="row-action" :title="abono.activo ? 'Desactivar' : 'Activar'" aria-label="Activar o desactivar" @click="toggle(abono)">
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('abonos:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="confirmDelete(abono)">
                      <IonIcon :icon="trashOutline" class="text-[15px]" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>

            <tbody v-else>
              <tr>
                <td colspan="6" class="!h-auto">
                  <div class="flex flex-col items-center py-12 text-center">
                    <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
                      <IonIcon :icon="walletOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">{{ filtros.search || filtros.estado || filtros.moneda ? 'Sin resultados con estos filtros' : 'Todavía no hay abonos' }}</p>
                    <p class="text-xs text-ink-faint mt-1">Creá el primero con «Nuevo abono».</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="abonosStore.meta && abonosStore.meta.totalPages > 1" class="flex items-center justify-between mt-3 text-xs text-ink-soft">
          <span class="tnum">{{ abonosStore.meta.totalItems }} abono(s)</span>
          <div class="flex gap-1">
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!abonosStore.meta.hasPrevPage" @click="page--; load()">Anterior</button>
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!abonosStore.meta.hasNextPage" @click="page++; load()">Siguiente</button>
          </div>
        </div>
      </div>

      <ActualizarPreciosModal
        :open="modalActualizar"
        :ids="idsSeleccionados"
        :hay-ars="hayArs"
        :hay-usd="hayUsd"
        @close="modalActualizar = false"
        @applied="seleccion = new Set(); load()"
      />
      <FacturarModal
        :open="modalFacturar"
        :ids="idsSeleccionados"
        @close="modalFacturar = false"
        @applied="seleccion = new Set(); load()"
      />
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
