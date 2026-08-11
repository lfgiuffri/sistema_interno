<script setup lang="ts">
/**
 * Alta/edición de proyecto. Las 5 fechas del ciclo de vida son OPCIONALES e
 * independientes (no hay máquina de estados — regla del legado); solo la entrega
 * estimada alimenta las alertas del panel.
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  IonPage, IonContent, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonIcon,
} from '@ionic/vue'
import { chevronBackOutline, cashOutline } from 'ionicons/icons'
import api from '@/services/api'
import { useProyectosStore, ESTADOS_PROYECTO } from '@/stores/proyectos'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'

interface Opcion { value: number; label: string }

const route = useRoute()
const router = useRouter()
const store = useProyectosStore()
const meStore = useMeStore()
const toast = useToast()

const id = computed(() => Number(route.params.id) || 0)
const isEdit = computed(() => id.value > 0)

const form = ref({
  clienteId: 0, nombre: '', servicioId: 0, estado: 'en_diseno',
  moneda: 'USD' as 'ARS' | 'USD', total: '',
  fechaConfirmacion: '', fechaOnboarding: '', fechaAprobacionDiseno: '',
  fechaEstimadaEntrega: '', fechaEntrega: '', observaciones: '',
})
const clientes = ref<Opcion[]>([])
const servicios = ref<Opcion[]>([])
const formError = ref('')

const canSave = computed(() =>
  form.value.clienteId > 0 && form.value.nombre.trim() !== ''
  && form.value.total !== '' && Number(form.value.total) >= 0
)

// Fechas del ciclo de vida, en orden cronológico típico (todas opcionales).
const FECHAS: Array<{ key: 'fechaConfirmacion' | 'fechaOnboarding' | 'fechaAprobacionDiseno' | 'fechaEstimadaEntrega' | 'fechaEntrega'; label: string; hint?: string }> = [
  { key: 'fechaConfirmacion', label: 'Confirmación' },
  { key: 'fechaOnboarding', label: 'Onboarding' },
  { key: 'fechaAprobacionDiseno', label: 'Aprobación de diseño' },
  { key: 'fechaEstimadaEntrega', label: 'Entrega estimada', hint: 'Alimenta las alertas del panel (5 días)' },
  { key: 'fechaEntrega', label: 'Entrega real' },
]

/** Selects de cliente y servicio (los inactivos marcados: el valor actual no se pierde). */
async function loadOpciones(): Promise<void> {
  const [c, s] = await Promise.all([
    api.get('/clientes', { params: { limit: 200 } }),
    api.get('/servicios', { params: { limit: 200 } }),
  ])
  const mark = (r: { id: number; nombre: string; activo: boolean }) => ({ value: r.id, label: r.activo ? r.nombre : `${r.nombre} (inactivo)` })
  if (c.data.success) clientes.value = c.data.data.map(mark)
  if (s.data.success) servicios.value = s.data.data.map(mark)
}

async function loadProyecto(): Promise<void> {
  if (!isEdit.value) return
  const p = await store.fetchOne(id.value)
  if (!p) { toast.error('Proyecto no encontrado'); router.replace('/proyectos'); return }
  form.value = {
    clienteId: p.clienteId,
    nombre: p.nombre,
    servicioId: p.servicioId ?? 0,
    estado: p.estado,
    moneda: p.moneda,
    total: String(p.total),
    fechaConfirmacion: p.fechaConfirmacion ?? '',
    fechaOnboarding: p.fechaOnboarding ?? '',
    fechaAprobacionDiseno: p.fechaAprobacionDiseno ?? '',
    fechaEstimadaEntrega: p.fechaEstimadaEntrega ?? '',
    fechaEntrega: p.fechaEntrega ?? '',
    observaciones: p.observaciones ?? '',
  }
}

async function save(): Promise<void> {
  if (!canSave.value || store.saving) return
  const payload: Record<string, unknown> = {
    ...form.value,
    nombre: form.value.nombre.trim(),
    total: Number(form.value.total),
    servicioId: form.value.servicioId || 0,
    observaciones: form.value.observaciones.trim() || undefined,
  }
  const r = await store.save(payload, isEdit.value ? id.value : undefined)
  if (!r.ok) { formError.value = r.message; return }
  toast.success(isEdit.value ? 'Proyecto actualizado' : 'Proyecto creado')
  router.replace('/proyectos')
}

onMounted(async () => {
  await Promise.all([loadOpciones(), loadProyecto()])
})
</script>

<template>
  <IonPage>
    <IonHeader class="ion-no-border">
      <IonToolbar class="app-toolbar">
        <IonButtons slot="start" class="lg:hidden"><IonMenuButton /></IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent class="page-content">
      <div class="max-w-3xl mx-auto px-5 lg:px-8 py-6 ds-enter">

        <button class="ds-btn-ghost h-8 -ml-2 mb-3" @click="router.back()">
          <IonIcon :icon="chevronBackOutline" class="text-[14px]" />
          Proyectos
        </button>

        <header class="flex items-center justify-between gap-4 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">
              {{ isEdit ? `Editar proyecto · ${form.nombre}` : 'Nuevo proyecto' }}
            </h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              El presupuesto define el tope de planificación de cuotas (0 = sin tope).
            </p>
          </div>
          <button
            v-if="isEdit && meStore.canAny('cobranzas')"
            class="ds-btn-secondary"
            @click="router.push(`/proyectos/${id}/cobranzas`)"
          >
            <IonIcon :icon="cashOutline" class="text-[15px]" />
            Cobranzas
          </button>
        </header>

        <form class="ds-card p-5 space-y-4" @submit.prevent="save">
          <div class="grid sm:grid-cols-2 gap-3">
            <div>
              <label class="ds-label" for="pr-cliente">Cliente</label>
              <select id="pr-cliente" v-model.number="form.clienteId" class="ds-input" required>
                <option :value="0" disabled>Elegí un cliente…</option>
                <option v-for="o in clientes" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
            <div>
              <label class="ds-label" for="pr-nombre">Nombre del proyecto</label>
              <input id="pr-nombre" v-model="form.nombre" class="ds-input" type="text" placeholder="Ej: Rediseño e-commerce" required />
            </div>
          </div>

          <div class="grid sm:grid-cols-2 gap-3">
            <div>
              <label class="ds-label" for="pr-servicio">Servicio</label>
              <select id="pr-servicio" v-model.number="form.servicioId" class="ds-input">
                <option :value="0">— Sin servicio —</option>
                <option v-for="o in servicios" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <p class="ds-hint">Define el área a la que suma la facturación.</p>
            </div>
            <div>
              <label class="ds-label" for="pr-estado">Estado</label>
              <select id="pr-estado" v-model="form.estado" class="ds-input">
                <option v-for="(e, key) in ESTADOS_PROYECTO" :key="key" :value="key">{{ e.label }}</option>
              </select>
            </div>
          </div>

          <div class="grid sm:grid-cols-2 gap-3">
            <div>
              <label class="ds-label" for="pr-moneda">Moneda del presupuesto</label>
              <select id="pr-moneda" v-model="form.moneda" class="ds-input">
                <option value="USD">Dólares (USD)</option>
                <option value="ARS">Pesos (ARS)</option>
              </select>
            </div>
            <div>
              <label class="ds-label" for="pr-total">Presupuesto</label>
              <input id="pr-total" v-model="form.total" class="ds-input font-mono" type="number" min="0" step="0.01" required />
              <p class="ds-hint">Las cuotas se planifican en USD hasta este tope (convertido si es ARS).</p>
            </div>
          </div>

          <fieldset>
            <legend class="ds-label mb-2">Ciclo de vida</legend>
            <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div v-for="f in FECHAS" :key="f.key">
                <label class="ds-label" :for="`pr-${f.key}`">{{ f.label }}</label>
                <input :id="`pr-${f.key}`" v-model="form[f.key]" class="ds-input" type="date" />
                <p v-if="f.hint" class="ds-hint">{{ f.hint }}</p>
              </div>
            </div>
          </fieldset>

          <div>
            <label class="ds-label" for="pr-obs">Observaciones</label>
            <textarea id="pr-obs" v-model="form.observaciones" class="ds-input !h-auto min-h-[64px] py-2" rows="2"></textarea>
          </div>

          <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>

          <footer class="flex justify-end gap-2 pt-1">
            <button type="button" class="ds-btn-secondary" @click="router.back()">Cancelar</button>
            <button type="submit" class="ds-btn-primary" :disabled="!canSave || store.saving">
              {{ store.saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear proyecto') }}
            </button>
          </footer>
        </form>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
</style>
