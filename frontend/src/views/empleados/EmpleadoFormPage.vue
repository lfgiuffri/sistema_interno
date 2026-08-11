<script setup lang="ts">
/**
 * Alta/edición de la ficha de empleado. El sueldo NO se toca acá (módulo Sueldos).
 * El campo de días de vacaciones se OCULTA para Freelance pero el valor se conserva
 * (volver de Freelance no pierde la config — regla del legado).
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  IonPage, IonContent, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonIcon,
} from '@ionic/vue'
import { chevronBackOutline } from 'ionicons/icons'
import api from '@/services/api'
import { useEmpleadosStore, CATEGORIAS, ESTADOS_CIVILES } from '@/stores/empleados'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const empleadosStore = useEmpleadosStore()
const toast = useToast()

const id = computed(() => Number(route.params.id) || 0)
const isEdit = computed(() => id.value > 0)

const form = ref({
  nombre: '', dni: '', cuil: '', nacionalidad: '', fechaNacimiento: '', domicilio: '',
  telefono: '', email: '', estadoCivil: '', cargasFamiliares: '',
  cuNombre: '', cuTelefono: '', cuParentesco: '',
  fechaIngreso: '', observaciones: '',
  categoria: 'Relación de dependencia', vacDiasAnuales: 14,
})
const areasSel = ref<Set<number>>(new Set())
const areas = ref<Array<{ id: number; nombre: string }>>([])
const formError = ref('')
const guardando = ref(false)

const esFreelance = computed(() => form.value.categoria === 'Freelance')

async function loadAreas(): Promise<void> {
  const res = await api.get('/areas', { params: { limit: 200, activo: 'true' } })
  if (res.data.success) areas.value = res.data.data
}

async function loadEmpleado(): Promise<void> {
  if (!isEdit.value) return
  const ficha = await empleadosStore.fetchFicha(id.value)
  if (!ficha) { toast.error('Empleado no encontrado'); router.replace('/empleados'); return }
  form.value = {
    nombre: ficha.nombre,
    dni: ficha.dni ?? '', cuil: ficha.cuil ?? '', nacionalidad: ficha.nacionalidad ?? '',
    fechaNacimiento: ficha.fechaNacimiento ?? '', domicilio: ficha.domicilio ?? '',
    telefono: ficha.telefono ?? '', email: ficha.email ?? '',
    estadoCivil: ficha.estadoCivil ?? '', cargasFamiliares: ficha.cargasFamiliares ?? '',
    cuNombre: ficha.cuNombre ?? '', cuTelefono: ficha.cuTelefono ?? '', cuParentesco: ficha.cuParentesco ?? '',
    fechaIngreso: ficha.fechaIngreso ?? '', observaciones: ficha.observaciones ?? '',
    categoria: ficha.categoria, vacDiasAnuales: ficha.vacDiasAnuales,
  }
  areasSel.value = new Set(ficha.areas.map(a => a.id))
}

function toggleArea(areaId: number): void {
  const next = new Set(areasSel.value)
  if (next.has(areaId)) next.delete(areaId)
  else next.add(areaId)
  areasSel.value = next
}

async function save(): Promise<void> {
  if (!form.value.nombre.trim() || guardando.value) return
  guardando.value = true
  formError.value = ''
  const r = await empleadosStore.save({ ...form.value, areas: [...areasSel.value] }, isEdit.value ? id.value : undefined)
  guardando.value = false
  if (!r.ok) { formError.value = r.message; return }
  const nuevoId = isEdit.value ? id.value : (r.data as { id: number }).id
  toast.success(isEdit.value ? 'Empleado actualizado' : 'Empleado creado. Cargá su sueldo desde el módulo Sueldos.')
  router.replace(`/empleados/${nuevoId}`)
}

onMounted(async () => {
  await Promise.all([loadAreas(), loadEmpleado()])
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
          Empleados
        </button>

        <header class="pb-5">
          <h1 class="text-xl font-semibold tracking-tight text-ink">
            {{ isEdit ? `Editar ficha · ${form.nombre}` : 'Nuevo empleado' }}
          </h1>
          <p class="mt-0.5 text-sm text-ink-soft">El sueldo se carga y administra desde el módulo Sueldos.</p>
        </header>

        <form class="space-y-5" @submit.prevent="save">
          <!-- Datos personales -->
          <section class="ds-card p-5 space-y-4">
            <h2 class="text-sm font-semibold text-ink">Datos personales</h2>
            <div class="grid sm:grid-cols-2 gap-3">
              <div class="sm:col-span-2">
                <label class="ds-label" for="em-nombre">Nombre completo</label>
                <input id="em-nombre" v-model="form.nombre" class="ds-input" type="text" required maxlength="150" />
              </div>
              <div>
                <label class="ds-label" for="em-dni">DNI</label>
                <input id="em-dni" v-model="form.dni" class="ds-input font-mono" type="text" maxlength="20" />
              </div>
              <div>
                <label class="ds-label" for="em-cuil">CUIL</label>
                <input id="em-cuil" v-model="form.cuil" class="ds-input font-mono" type="text" maxlength="20" />
              </div>
              <div>
                <label class="ds-label" for="em-nac">Nacionalidad</label>
                <input id="em-nac" v-model="form.nacionalidad" class="ds-input" type="text" maxlength="60" />
              </div>
              <div>
                <label class="ds-label" for="em-fnac">Fecha de nacimiento</label>
                <input id="em-fnac" v-model="form.fechaNacimiento" class="ds-input" type="date" />
              </div>
              <div class="sm:col-span-2">
                <label class="ds-label" for="em-dom">Domicilio</label>
                <input id="em-dom" v-model="form.domicilio" class="ds-input" type="text" maxlength="200" />
              </div>
              <div>
                <label class="ds-label" for="em-tel">Teléfono</label>
                <input id="em-tel" v-model="form.telefono" class="ds-input" type="tel" maxlength="40" />
              </div>
              <div>
                <label class="ds-label" for="em-email">Email</label>
                <input id="em-email" v-model="form.email" class="ds-input" type="email" maxlength="150" />
              </div>
              <div>
                <label class="ds-label" for="em-ecivil">Estado civil</label>
                <select id="em-ecivil" v-model="form.estadoCivil" class="ds-input">
                  <option value="">—</option>
                  <option v-for="ec in ESTADOS_CIVILES" :key="ec" :value="ec">{{ ec }}</option>
                </select>
              </div>
              <div>
                <label class="ds-label" for="em-cargas">Cargas familiares</label>
                <input id="em-cargas" v-model="form.cargasFamiliares" class="ds-input" type="text" maxlength="200" />
              </div>
            </div>
          </section>

          <!-- Contacto de urgencia -->
          <section class="ds-card p-5 space-y-4">
            <h2 class="text-sm font-semibold text-ink">Contacto de urgencia</h2>
            <div class="grid sm:grid-cols-3 gap-3">
              <div>
                <label class="ds-label" for="em-cun">Nombre</label>
                <input id="em-cun" v-model="form.cuNombre" class="ds-input" type="text" maxlength="150" />
              </div>
              <div>
                <label class="ds-label" for="em-cut">Teléfono</label>
                <input id="em-cut" v-model="form.cuTelefono" class="ds-input" type="tel" maxlength="40" />
              </div>
              <div>
                <label class="ds-label" for="em-cup">Parentesco</label>
                <input id="em-cup" v-model="form.cuParentesco" class="ds-input" type="text" maxlength="60" />
              </div>
            </div>
          </section>

          <!-- Laboral -->
          <section class="ds-card p-5 space-y-4">
            <h2 class="text-sm font-semibold text-ink">Datos laborales</h2>
            <div class="grid sm:grid-cols-3 gap-3">
              <div>
                <label class="ds-label" for="em-cat">Categoría</label>
                <select id="em-cat" v-model="form.categoria" class="ds-input">
                  <option v-for="c in CATEGORIAS" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>
              <div>
                <label class="ds-label" for="em-fing">Fecha de ingreso</label>
                <input id="em-fing" v-model="form.fechaIngreso" class="ds-input" type="date" />
              </div>
              <div v-show="!esFreelance">
                <label class="ds-label" for="em-vac">Vacaciones (días/año)</label>
                <input id="em-vac" v-model.number="form.vacDiasAnuales" class="ds-input font-mono" type="number" min="0" />
                <p class="ds-hint">Se puede ajustar por año desde la ficha.</p>
              </div>
            </div>
            <p v-if="esFreelance" class="ds-hint">Freelance no genera vacaciones (la config se conserva por si cambia de categoría).</p>

            <div>
              <span class="ds-label">Áreas</span>
              <div v-if="areas.length" class="flex flex-wrap gap-2">
                <label
                  v-for="a in areas"
                  :key="a.id"
                  class="flex items-center gap-1.5 px-2.5 h-8 rounded-lg border text-sm cursor-pointer select-none transition-colors"
                  :class="areasSel.has(a.id) ? 'border-accent/40 bg-accent-soft text-accent-ink font-medium' : 'border-line text-ink-soft hover:bg-surface-2'"
                >
                  <input type="checkbox" class="accent-[#0F7660]" :checked="areasSel.has(a.id)" @change="toggleArea(a.id)" />
                  {{ a.nombre }}
                </label>
              </div>
              <p v-else class="ds-hint">No hay áreas activas. Crealas en Catálogos → Áreas.</p>
            </div>

            <div>
              <label class="ds-label" for="em-obs">Observaciones</label>
              <textarea id="em-obs" v-model="form.observaciones" class="ds-input !h-auto min-h-[64px] py-2" rows="2"></textarea>
            </div>
          </section>

          <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>

          <footer class="flex justify-end gap-2">
            <button type="button" class="ds-btn-secondary" @click="router.back()">Cancelar</button>
            <button type="submit" class="ds-btn-primary" :disabled="!form.nombre.trim() || guardando">
              {{ guardando ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear empleado') }}
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
