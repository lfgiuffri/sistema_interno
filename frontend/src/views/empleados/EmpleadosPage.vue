<script setup lang="ts">
/**
 * Empleados — listado con categoría, áreas, contacto, vacaciones disponibles y estado.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  addOutline, createOutline, trashOutline, powerOutline, personOutline, eyeOutline,
} from 'ionicons/icons'
import { useEmpleadosStore, type EmpleadoRow } from '@/stores/empleados'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { fecha as fmtFecha } from '@/composables/useFormato'

const CATEGORIA_BADGE: Record<string, string> = {
  'Socio': 'ds-badge-accent',
  'Relación de dependencia': 'ds-badge-ok',
  'Monotributo': 'ds-badge-warn',
  'Freelance': 'ds-badge-neutral',
}

const empleadosStore = useEmpleadosStore()
const meStore = useMeStore()
const toast = useToast()
const router = useRouter()

async function toggle(e: EmpleadoRow): Promise<void> {
  const r = await empleadosStore.toggle(e.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Estado del empleado cambiado')
  await empleadosStore.fetchAll()
}

async function confirmDelete(e: EmpleadoRow): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar empleado',
    message: `¿Eliminar a ${e.nombre}? Si tiene sueldos, pagos o archivos no se puede eliminar.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await empleadosStore.remove(e.id)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Empleado eliminado')
          await empleadosStore.fetchAll()
        },
      },
    ],
  })
  await alert.present()
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void empleadosStore.fetchAll() })
onIonViewWillEnter(() => { if (loadedOnce) void empleadosStore.fetchAll() })
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
            <h1 class="text-xl font-semibold tracking-tight text-ink">Empleados</h1>
            <p class="mt-0.5 text-sm text-ink-soft tnum">
              {{ empleadosStore.rows.filter(e => e.activo).length }} activo(s). El sueldo se administra desde Sueldos.
            </p>
          </div>
          <button v-if="meStore.can('empleados:create')" class="ds-btn-primary" @click="router.push('/empleados/nuevo')">
            <IonIcon :icon="addOutline" class="text-[16px]" />
            Nuevo empleado
          </button>
        </header>

        <div class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Categoría</th>
                <th>Áreas</th>
                <th>Contacto</th>
                <th>Vac. disp.</th>
                <th>Estado</th>
                <th class="w-28"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>

            <tbody v-if="empleadosStore.loading && !empleadosStore.rows.length">
              <tr v-for="i in 4" :key="i"><td colspan="7" class="!px-3"><div class="ds-skeleton h-5 w-full my-2"></div></td></tr>
            </tbody>

            <tbody v-else-if="empleadosStore.rows.length">
              <tr v-for="e in empleadosStore.rows" :key="e.id" :class="{ 'opacity-50': !e.activo }">
                <td>
                  <button class="text-left group" @click="router.push(`/empleados/${e.id}`)">
                    <p class="font-medium text-ink group-hover:text-accent transition-colors">{{ e.nombre }}</p>
                    <p v-if="e.fechaIngreso" class="text-2xs text-ink-faint">ingreso {{ fmtFecha(e.fechaIngreso) }}</p>
                  </button>
                </td>
                <td><span :class="CATEGORIA_BADGE[e.categoria] ?? 'ds-badge-neutral'">{{ e.categoria }}</span></td>
                <td>
                  <div class="flex flex-wrap gap-1 max-w-[180px]">
                    <span v-for="a in e.areas" :key="a.id" class="ds-badge-neutral">{{ a.nombre }}</span>
                    <span v-if="!e.areas.length" class="text-ink-faint">—</span>
                  </div>
                </td>
                <td>
                  <p v-if="e.email" class="text-xs text-ink-soft">{{ e.email }}</p>
                  <p v-if="e.telefono" class="text-2xs text-ink-faint tnum">{{ e.telefono }}</p>
                  <span v-if="!e.email && !e.telefono" class="text-ink-faint">—</span>
                </td>
                <td>
                  <template v-if="e.vacaciones">
                    <span v-if="!e.vacaciones.aplica" class="text-2xs text-ink-faint">no aplica</span>
                    <div v-else class="flex items-center gap-1.5">
                      <span class="tnum font-medium text-ink">{{ e.vacaciones.disponible }}</span>
                      <span v-if="e.vacaciones.sobregiro" class="ds-badge-danger" title="Tiene sobregiro">!</span>
                    </div>
                  </template>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td>
                  <span :class="e.activo ? 'ds-badge-ok' : 'ds-badge-neutral'">{{ e.activo ? 'Activo' : 'Inactivo' }}</span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <button class="row-action" title="Ver ficha" aria-label="Ver ficha" @click="router.push(`/empleados/${e.id}`)">
                      <IonIcon :icon="eyeOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('empleados:update')" class="row-action" title="Editar" aria-label="Editar" @click="router.push(`/empleados/${e.id}/editar`)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('empleados:toggle')" class="row-action" :title="e.activo ? 'Desactivar' : 'Activar'" aria-label="Activar o desactivar" @click="toggle(e)">
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('empleados:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="confirmDelete(e)">
                      <IonIcon :icon="trashOutline" class="text-[15px]" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>

            <tbody v-else>
              <tr>
                <td colspan="7" class="!h-auto">
                  <div class="flex flex-col items-center py-12 text-center">
                    <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
                      <IonIcon :icon="personOutline" class="text-[18px] text-ink-faint" />
                    </div>
                    <p class="text-sm font-medium text-ink">Todavía no hay empleados</p>
                    <p class="text-xs text-ink-faint mt-1">Creá el primero con «Nuevo empleado».</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
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
