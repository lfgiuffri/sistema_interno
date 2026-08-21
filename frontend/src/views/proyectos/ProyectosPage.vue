<script setup lang="ts">
/**
 * Proyectos — listado con filtro por estado (default: abiertos, regla del legado),
 * búsqueda, alerta de entrega (≤ 5 días) y acceso directo a las cobranzas.
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  addOutline, searchOutline, createOutline, trashOutline, cashOutline, folderOpenOutline,
} from 'ionicons/icons'
import { useProyectosStore, ESTADOS_PROYECTO, ESTADOS_ABIERTOS, type Proyecto } from '@/stores/proyectos'
import ThOrdenable from '@/components/shared/ThOrdenable.vue'
import { useOrdenRemoto } from '@/composables/useOrdenTabla'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { moneda as fmtMoneda, fecha as fmtFecha } from '@/composables/useFormato'

const store = useProyectosStore()
const meStore = useMeStore()
const toast = useToast()
const router = useRouter()

// '' = abiertos (default legado); 'todos' = sin filtro; o un estado puntual.
const filtroEstado = ref('')
const search = ref('')
const page = ref(1)
let searchTimer: ReturnType<typeof setTimeout> | null = null

// Orden del servidor (listado paginado). Sin columna elegida manda el default del legado:
// abiertos primero y los cerrados al final.
const orden = useOrdenRemoto(() => { page.value = 1; void load() })

async function load(): Promise<void> {
  const estado = filtroEstado.value === 'todos'
    ? undefined
    : (filtroEstado.value || ESTADOS_ABIERTOS.join(','))
  await store.fetchList({ estado, search: search.value, page: page.value, ...orden.params.value })
}

function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; void load() }, 250)
}

function onFiltro(): void { page.value = 1; void load() }

async function confirmDelete(p: Proyecto): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar proyecto',
    message: `¿Eliminar «${p.nombre}» de ${p.cliente?.nombre}? Si tiene cobranzas cobradas no se puede eliminar.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await store.remove(p.id)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Proyecto eliminado')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

/** Badge de entrega según los días calculados (solo proyectos abiertos con fecha). */
function badgeEntrega(p: Proyecto): { clase: string; texto: string } | null {
  if (p.diasParaEntrega === null || p.diasParaEntrega === undefined) return null
  if (['finalizado', 'finalizado_incompleto'].includes(p.estado)) return null
  const d = p.diasParaEntrega
  if (d < 0) return { clase: 'ds-badge-danger', texto: `Atrasado ${Math.abs(d)} d` }
  if (d <= 5) return { clase: 'ds-badge-warn', texto: d === 0 ? 'Hoy' : `En ${d} d` }
  return null
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
            <h1 class="text-xl font-semibold tracking-tight text-ink">Proyectos</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Trabajos puntuales: ciclo de vida, presupuesto y cobranzas en cuotas.</p>
          </div>
          <button v-if="meStore.can('proyectos:create')" class="ds-btn-primary" @click="router.push('/proyectos/nuevo')">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nuevo proyecto
          </button>
        </header>

        <!-- Filtros -->
        <div class="flex flex-wrap items-end gap-3 mb-4">
          <div class="relative w-56">
            <IonIcon :icon="searchOutline" class="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint pointer-events-none" />
            <input v-model="search" class="ds-input h-9 pl-9" type="search" placeholder="Buscar proyecto…" @input="onSearch" />
          </div>
          <select v-model="filtroEstado" class="ds-input h-9 w-52" @change="onFiltro">
            <option value="">Abiertos (en curso)</option>
            <option v-for="(e, key) in ESTADOS_PROYECTO" :key="key" :value="key">{{ e.label }}</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        <!-- Tabla -->
        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <ThOrdenable columna="nombre" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Proyecto</ThOrdenable>
                <ThOrdenable columna="servicio" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Servicio / Área</ThOrdenable>
                <ThOrdenable columna="estado" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Estado</ThOrdenable>
                <ThOrdenable columna="presupuesto" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Presupuesto</ThOrdenable>
                <ThOrdenable columna="fechaEstimadaEntrega" :activa="orden.columna.value" :dir="orden.dir.value" @ordenar="orden.ordenarPor">Entrega estimada</ThOrdenable>
                <th class="w-28"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="store.loading && !store.rows.length">
              <tr v-for="i in 5" :key="i"><td colspan="6" class="!px-3"><div class="ds-skeleton h-5 w-full my-2"></div></td></tr>
            </tbody>

            <tbody v-else-if="store.rows.length">
              <tr v-for="p in store.rows" :key="p.id">
                <td>
                  <p class="font-medium text-ink">{{ p.nombre }}</p>
                  <p class="text-2xs text-ink-faint">{{ p.cliente?.nombre }}</p>
                </td>
                <td>
                  <p class="text-ink-soft text-sm">{{ p.servicio?.nombre ?? '—' }}</p>
                  <p v-if="p.servicio?.area" class="text-2xs text-ink-faint">{{ p.servicio.area.nombre }}</p>
                </td>
                <td>
                  <span :class="ESTADOS_PROYECTO[p.estado]?.badge ?? 'ds-badge-neutral'">
                    {{ ESTADOS_PROYECTO[p.estado]?.label ?? p.estado }}
                  </span>
                </td>
                <td>
                  <div class="flex items-center gap-1.5">
                    <span class="ds-badge-neutral !h-[18px] !text-2xs font-mono">{{ p.moneda }}</span>
                    <span class="tnum font-medium text-ink">{{ fmtMoneda(p.total, p.moneda) }}</span>
                  </div>
                </td>
                <td>
                  <div class="flex items-center gap-2">
                    <span class="text-ink-soft tnum">{{ fmtFecha(p.fechaEstimadaEntrega) }}</span>
                    <span v-if="badgeEntrega(p)" :class="badgeEntrega(p)!.clase">{{ badgeEntrega(p)!.texto }}</span>
                  </div>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <button v-if="meStore.canAny('cobranzas')" class="row-action" title="Cobranzas" aria-label="Cobranzas" @click="router.push(`/proyectos/${p.id}/cobranzas`)">
                      <IonIcon :icon="cashOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('proyectos:update')" class="row-action" title="Editar" aria-label="Editar" @click="router.push(`/proyectos/${p.id}/editar`)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('proyectos:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="confirmDelete(p)">
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
                      <IonIcon :icon="folderOpenOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">{{ search || filtroEstado ? 'Sin resultados con estos filtros' : 'Todavía no hay proyectos abiertos' }}</p>
                    <p class="text-xs text-ink-faint mt-1">Probá «Todos» para ver los finalizados, o creá uno nuevo.</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="store.meta && store.meta.totalPages > 1" class="flex items-center justify-between mt-3 text-xs text-ink-soft">
          <span class="tnum">{{ store.meta.totalItems }} proyecto(s)</span>
          <div class="flex gap-1">
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!store.meta.hasPrevPage" @click="page--; load()">Anterior</button>
            <button class="ds-btn-secondary h-7 px-2.5 text-xs" :disabled="!store.meta.hasNextPage" @click="page++; load()">Siguiente</button>
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
