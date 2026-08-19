<script setup lang="ts">
/**
 * Ficha de empleado: datos completos, VACACIONES (disponible + desglose por año con
 * vencimientos, registrar/eliminar tomas, ajustes por año, tabla de otorgamientos) y
 * ARCHIVOS (subir/descargar/eliminar). Los bloques aparecen según capabilities.
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon, alertController,
} from '@ionic/vue'
import {
  chevronBackOutline, createOutline, attachOutline, downloadOutline, trashOutline,
  sunnyOutline, addOutline,
} from 'ionicons/icons'
import { useEmpleadosStore, type FichaEmpleado, type VacacionesEstado } from '@/stores/empleados'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { fecha as fmtFecha } from '@/composables/useFormato'

const route = useRoute()
const router = useRouter()
const empleadosStore = useEmpleadosStore()
const meStore = useMeStore()
const toast = useToast()

const id = computed(() => Number(route.params.id) || 0)
const ficha = ref<FichaEmpleado | null>(null)
const loading = ref(false)

const vac = computed(() => (ficha.value?.vacaciones?.aplica ? ficha.value.vacaciones as VacacionesEstado : null))

// Forms inline
const tomaForm = ref({ fechaDesde: '', fechaHasta: '', observacion: '' })
const tomaError = ref('')
const asigForm = ref({ anio: new Date().getFullYear(), dias: '' as string | number })
const archivoDesc = ref('')
const subiendo = ref(false)

async function load(): Promise<void> {
  loading.value = true
  const data = await empleadosStore.fetchFicha(id.value)
  loading.value = false
  if (!data) { toast.error('Empleado no encontrado'); router.replace('/empleados'); return }
  ficha.value = data
}

async function registrarToma(): Promise<void> {
  tomaError.value = ''
  if (!tomaForm.value.fechaDesde || !tomaForm.value.fechaHasta) {
    tomaError.value = 'Cargá la fecha de inicio y de fin'
    return
  }
  const r = await empleadosStore.addToma(id.value, {
    fechaDesde: tomaForm.value.fechaDesde,
    fechaHasta: tomaForm.value.fechaHasta,
    observacion: tomaForm.value.observacion.trim() || undefined,
  })
  if (!r.ok) { tomaError.value = r.message; return }
  toast.success(`Vacaciones registradas (${(r.data as { dias: number }).dias} día/s)`)
  tomaForm.value = { fechaDesde: '', fechaHasta: '', observacion: '' }
  await load()
}

async function eliminarToma(tomaId: number): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar período',
    message: '¿Eliminar este período de vacaciones? Los días vuelven a estar disponibles.',
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await empleadosStore.removeToma(id.value, tomaId)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Período de vacaciones eliminado')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

async function guardarAsignacion(): Promise<void> {
  const dias = String(asigForm.value.dias).trim() === '' ? null : Number(asigForm.value.dias)
  const r = await empleadosStore.setAsignacion(id.value, Number(asigForm.value.anio), dias)
  if (!r.ok) { toast.error(r.message); return }
  toast.success((r.data as { message: string }).message)
  asigForm.value.dias = ''
  await load()
}

async function subirArchivo(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!archivoDesc.value.trim()) { toast.error('Poné una descripción para el archivo'); return }
  subiendo.value = true
  const r = await empleadosStore.subirArchivo(id.value, file, archivoDesc.value.trim())
  subiendo.value = false
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Archivo subido')
  archivoDesc.value = ''
  await load()
}

async function eliminarArchivo(archivoId: number): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar archivo',
    message: '¿Eliminar este archivo? No se puede deshacer.',
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await empleadosStore.removeArchivo(id.value, archivoId)
          if (!r.ok) { toast.error(r.message); return }
          toast.success('Archivo eliminado')
          await load()
        },
      },
    ],
  })
  await alert.present()
}

/** Campos de la ficha para el <dl> (vacíos → —). */
const DATOS: Array<{ label: string; key: keyof FichaEmpleado }> = [
  { label: 'DNI', key: 'dni' }, { label: 'CUIL', key: 'cuil' },
  { label: 'Nacionalidad', key: 'nacionalidad' }, { label: 'Nacimiento', key: 'fechaNacimiento' },
  { label: 'Domicilio', key: 'domicilio' }, { label: 'Teléfono', key: 'telefono' },
  { label: 'Email', key: 'email' }, { label: 'Estado civil', key: 'estadoCivil' },
  { label: 'Cargas familiares', key: 'cargasFamiliares' }, { label: 'Ingreso', key: 'fechaIngreso' },
]

const valorDato = (key: keyof FichaEmpleado): string => {
  const v = ficha.value?.[key]
  if (!v) return '—'
  if (key === 'fechaNacimiento' || key === 'fechaIngreso') return fmtFecha(String(v))
  return String(v)
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
      <div class="max-w-4xl mx-auto px-5 lg:px-8 py-6 ds-enter">

        <button class="ds-btn-ghost h-8 -ml-2 mb-3" @click="router.push('/empleados')">
          <IonIcon :icon="chevronBackOutline" class="text-[14px]" />
          Empleados
        </button>

        <div v-if="loading && !ficha" class="space-y-3">
          <div class="ds-skeleton h-8 w-72"></div>
          <div class="ds-skeleton h-40"></div>
        </div>

        <template v-if="ficha">
          <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
            <div>
              <h1 class="text-xl font-semibold tracking-tight text-ink flex items-center gap-2">
                {{ ficha.nombre }}
                <span :class="ficha.activo ? 'ds-badge-ok' : 'ds-badge-neutral'">{{ ficha.activo ? 'Activo' : 'Inactivo' }}</span>
              </h1>
              <p class="mt-0.5 text-sm text-ink-soft">
                {{ ficha.categoria }}
                <span v-if="ficha.areas.length"> · {{ ficha.areas.map(a => a.nombre).join(', ') }}</span>
              </p>
            </div>
            <div class="flex gap-2">
              <button v-if="meStore.can('sueldos:historial')" class="ds-btn-secondary h-8 text-xs" @click="router.push(`/sueldos?historial=${ficha.id}`)">
                Historial de sueldo
              </button>
              <button v-if="meStore.can('empleados:update')" class="ds-btn-secondary h-8 text-xs" @click="router.push(`/empleados/${ficha.id}/editar`)">
                <IonIcon :icon="createOutline" class="text-[13px]" />
                Editar ficha
              </button>
            </div>
          </header>

          <!-- Datos -->
          <section class="ds-card p-5 mb-5">
            <h2 class="text-sm font-semibold text-ink mb-3">Datos</h2>
            <dl class="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
              <div v-for="d in DATOS" :key="d.key" class="flex flex-col">
                <dt class="text-2xs uppercase tracking-wide text-ink-faint">{{ d.label }}</dt>
                <dd class="text-sm text-ink">{{ valorDato(d.key) }}</dd>
              </div>
              <div v-if="ficha.cuNombre" class="flex flex-col sm:col-span-2">
                <dt class="text-2xs uppercase tracking-wide text-ink-faint">Contacto de urgencia</dt>
                <dd class="text-sm text-ink">{{ ficha.cuNombre }}{{ ficha.cuParentesco ? ` (${ficha.cuParentesco})` : '' }}{{ ficha.cuTelefono ? ` · ${ficha.cuTelefono}` : '' }}</dd>
              </div>
            </dl>
            <p v-if="ficha.observaciones" class="mt-3 text-sm text-ink-soft border-t border-line-soft pt-3">{{ ficha.observaciones }}</p>
          </section>

          <!-- Vacaciones -->
          <section v-if="ficha.vacaciones" class="ds-card p-5 mb-5">
            <h2 class="text-sm font-semibold text-ink mb-3 flex items-center gap-1.5">
              <IonIcon :icon="sunnyOutline" class="text-[15px] text-ink-faint" />
              Vacaciones
            </h2>

            <p v-if="!vac" class="text-sm text-ink-soft">Esta categoría de empleado no genera vacaciones.</p>

            <template v-else>
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <div class="rounded-lg bg-surface-2/60 px-4 py-3">
                  <p class="text-2xs uppercase tracking-wide text-ink-faint">Disponibles</p>
                  <p class="mt-0.5 text-2xl font-semibold tnum text-ink">{{ vac.disponible }}</p>
                </div>
                <div class="rounded-lg bg-surface-2/60 px-4 py-3">
                  <p class="text-2xs uppercase tracking-wide text-ink-faint">Del año anterior</p>
                  <p class="mt-0.5 text-lg font-semibold tnum" :class="vac.dispAnterior ? 'text-warn' : 'text-ink'">{{ vac.dispAnterior }}</p>
                  <p class="text-2xs text-ink-faint">vencen el {{ vac.venceAnterior }}</p>
                </div>
                <div class="rounded-lg bg-surface-2/60 px-4 py-3">
                  <p class="text-2xs uppercase tracking-wide text-ink-faint">Del año actual</p>
                  <p class="mt-0.5 text-lg font-semibold tnum text-ink">{{ vac.dispActual }}</p>
                  <p class="text-2xs text-ink-faint">vencen el {{ vac.venceActual }}</p>
                </div>
                <div class="rounded-lg bg-surface-2/60 px-4 py-3">
                  <p class="text-2xs uppercase tracking-wide text-ink-faint">Tomados este año</p>
                  <p class="mt-0.5 text-lg font-semibold tnum text-ink">{{ vac.tomadosAnio }}</p>
                  <p v-if="vac.sobregiro" class="text-2xs text-danger">{{ vac.sobregiro }} en sobregiro</p>
                </div>
              </div>

              <!-- Registrar toma -->
              <form v-if="meStore.can('vacaciones:manage')" class="flex flex-wrap items-end gap-2 mb-4" @submit.prevent="registrarToma">
                <div>
                  <label class="ds-label" for="vt-desde">Desde</label>
                  <input id="vt-desde" v-model="tomaForm.fechaDesde" class="ds-input h-8 w-36" type="date" />
                </div>
                <div>
                  <label class="ds-label" for="vt-hasta">Hasta</label>
                  <input id="vt-hasta" v-model="tomaForm.fechaHasta" class="ds-input h-8 w-36" type="date" />
                </div>
                <div class="flex-1 min-w-[140px]">
                  <label class="ds-label" for="vt-obs">Observación</label>
                  <input id="vt-obs" v-model="tomaForm.observacion" class="ds-input h-8" type="text" maxlength="255" />
                </div>
                <button type="submit" class="ds-btn-primary h-8">
                  <IonIcon :icon="addOutline" class="text-[14px]" />
                  Registrar
                </button>
                <p v-if="tomaError" class="ds-error w-full" role="alert">{{ tomaError }}</p>
              </form>

              <!-- Períodos -->
              <div v-if="vac.tomas.length" class="border border-line rounded-lg divide-y divide-line-soft mb-4">
                <div v-for="t in vac.tomas" :key="t.id" class="flex items-center gap-3 px-3 h-10">
                  <span class="tnum text-sm text-ink">{{ fmtFecha(t.fechaDesde) }} → {{ fmtFecha(t.fechaHasta) }}</span>
                  <span class="ds-badge-neutral tnum">{{ t.dias }} día(s)</span>
                  <span v-if="t.sobregiro" class="ds-badge-danger" :title="`${t.sobregiro} día(s) por encima de lo disponible`">! sobregiro</span>
                  <span class="flex-1 text-xs text-ink-faint truncate">{{ t.observacion }}</span>
                  <button v-if="meStore.can('vacaciones:manage')" class="row-action hover:!text-danger" title="Eliminar período" aria-label="Eliminar período" @click="eliminarToma(t.id)">
                    <IonIcon :icon="trashOutline" class="text-[14px]" />
                  </button>
                </div>
              </div>

              <!-- Ajuste por año + otorgamientos -->
              <div class="grid lg:grid-cols-2 gap-4">
                <form v-if="meStore.can('vacaciones:manage')" class="flex flex-wrap items-end gap-2" @submit.prevent="guardarAsignacion">
                  <div>
                    <label class="ds-label" for="va-anio">Año</label>
                    <input id="va-anio" v-model.number="asigForm.anio" class="ds-input h-8 w-24 font-mono" type="number" min="2000" max="2100" />
                  </div>
                  <div>
                    <label class="ds-label" for="va-dias">Días</label>
                    <input id="va-dias" v-model="asigForm.dias" class="ds-input h-8 w-24 font-mono" type="number" min="0" placeholder="default" />
                  </div>
                  <button type="submit" class="ds-btn-secondary h-8">Ajustar año</button>
                </form>
                <div>
                  <p class="ds-label !mb-1">Otorgamientos</p>
                  <div class="flex flex-wrap gap-1.5">
                    <span
                      v-for="g in vac.grantsDetalle"
                      :key="g.anio"
                      :class="g.origen === 'ajuste' ? 'ds-badge-accent' : 'ds-badge-neutral'"
                      class="tnum"
                      :title="g.origen === 'ajuste' ? 'Ajuste manual del año' : 'Valor por defecto'"
                    >{{ g.anio }}: {{ g.dias }}</span>
                  </div>
                </div>
              </div>
            </template>
          </section>

          <!-- Archivos -->
          <section v-if="ficha.archivos" class="ds-card p-5">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-sm font-semibold text-ink flex items-center gap-1.5">
                <IonIcon :icon="attachOutline" class="text-[15px] text-ink-faint" />
                Archivos
              </h2>
            </div>

            <div v-if="meStore.can('empleados-archivos:upload')" class="flex flex-wrap items-end gap-2 mb-3">
              <div class="flex-1 min-w-[180px]">
                <label class="ds-label" for="ar-desc">Descripción</label>
                <input id="ar-desc" v-model="archivoDesc" class="ds-input h-8" type="text" placeholder="Ej: Contrato 2026" maxlength="200" />
              </div>
              <label class="ds-btn-secondary h-8 cursor-pointer" :class="{ 'opacity-60 pointer-events-none': subiendo }">
                <IonIcon :icon="attachOutline" class="text-[14px]" />
                {{ subiendo ? 'Subiendo…' : 'Subir archivo' }}
                <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.odt,.ods,.txt" @change="subirArchivo" />
              </label>
            </div>

            <div v-if="ficha.archivos.length" class="border border-line rounded-lg divide-y divide-line-soft">
              <div v-for="a in ficha.archivos" :key="a.id" class="flex items-center gap-3 px-3 h-11">
                <div class="flex-1 min-w-0">
                  <p class="text-sm text-ink truncate">{{ a.descripcion }}</p>
                  <p class="text-2xs text-ink-faint truncate">{{ a.nombreOriginal }} · {{ (a.size / 1024).toFixed(0) }} KB</p>
                </div>
                <span class="hidden sm:block text-2xs text-ink-faint shrink-0">{{ a.usuario ?? '—' }} · {{ fmtFecha(a.fecha) }}</span>
                <button class="row-action" title="Descargar" aria-label="Descargar" @click="empleadosStore.descargarArchivo(a.id, a.nombreOriginal)">
                  <IonIcon :icon="downloadOutline" class="text-[14px]" />
                </button>
                <button v-if="meStore.can('empleados-archivos:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar archivo" @click="eliminarArchivo(a.id)">
                  <IonIcon :icon="trashOutline" class="text-[14px]" />
                </button>
              </div>
            </div>
            <p v-else class="text-xs text-ink-faint">Sin archivos. Acepta PDF, imágenes, Office y texto (máx. 15 MB).</p>
          </section>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
.row-action {
  display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
</style>
