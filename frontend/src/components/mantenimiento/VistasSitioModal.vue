<script setup lang="ts">
/**
 * Administrar las **vistas** de un sitio: las URLs concretas que se chequean.
 *
 * Un sitio puede tener la home hecha por nosotros y un `/ecommerce` de un tercero. Cada vista
 * tiene su propio «lo administramos nosotros» (le exigimos el marcador del footer) y puede
 * pisar el id del marcador global, para un sitio viejo que todavía lleva otro.
 *
 * La ÚLTIMA vista no se puede borrar: un sitio sin ninguna URL dejaría de monitorearse en
 * silencio. Para eso está desactivar el sitio, que es explícito.
 */
import { ref, computed, onMounted } from 'vue'
import { IonIcon } from '@ionic/vue'
import {
  addOutline, createOutline, trashOutline, powerOutline, closeOutline,
  openOutline, checkmarkOutline,
} from 'ionicons/icons'
import { useMantenimientoStore, type SitioWeb, type SitioVista, type SitioVistaInput } from '@/stores/mantenimiento'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fechaHora } from '@/composables/useFormato'

const props = defineProps<{ sitio: SitioWeb }>()
const emit = defineEmits<{ cerrar: []; cambio: [] }>()

const store = useMantenimientoStore()
const meStore = useMeStore()
const toast = useToast()

const abierto = ref(true)
useEscapeToClose(abierto, () => emit('cerrar'))

const vistas = ref<SitioVista[]>([])
const cargando = ref(true)

/** Vista en edición (null = ninguna). `0` en el id significa «una nueva». */
const editando = ref<SitioVista | null>(null)
const nueva = ref(false)
const form = ref<SitioVistaInput>({ ruta: '', nombre: '', verificaMarcador: true, marcadorId: '' })
const formError = ref('')
const guardando = ref(false)

const puedeEditar = computed(() => meStore.can('sitios:update'))

const ETIQUETA: Record<string, string> = {
  online: 'En línea', sin_marcador: 'Sin marcador', offline: 'Caído', desconocido: 'Sin chequear',
}

/** Color del punto de estado de una vista. */
function colorEstado(e: string): string {
  if (e === 'online') return 'bg-ok'
  if (e === 'offline') return 'bg-danger'
  if (e === 'sin_marcador') return 'bg-warn'
  return 'bg-ink-faint'
}

/** URL absoluta que se chequea (se arma igual que en el servidor). */
function urlDe(ruta: string): string {
  try { return new URL(ruta || '/', props.sitio.url).toString() } catch { return props.sitio.url }
}

async function cargar(): Promise<void> {
  cargando.value = true
  vistas.value = await store.fetchVistas(props.sitio.id)
  cargando.value = false
}

function abrirNueva(): void {
  nueva.value = true
  editando.value = null
  // Arranca con el mismo criterio que el sitio: lo más probable es que la vista nueva sea
  // del mismo tipo que las que ya hay.
  form.value = { ruta: '/', nombre: '', verificaMarcador: props.sitio.verificaMarcador, marcadorId: '' }
  formError.value = ''
}

function abrirEdicion(v: SitioVista): void {
  nueva.value = false
  editando.value = v
  form.value = {
    ruta: v.ruta,
    nombre: v.nombre ?? '',
    verificaMarcador: v.verificaMarcador,
    // El null del servidor («usá el global») se muestra como campo vacío.
    marcadorId: v.marcadorId ?? '',
  }
  formError.value = ''
}

function cerrarForm(): void {
  nueva.value = false
  editando.value = null
}

async function guardar(): Promise<void> {
  formError.value = ''
  guardando.value = true
  const r = await store.saveVista(props.sitio.id, { ...form.value }, editando.value?.id)
  guardando.value = false
  if (!r.ok) { formError.value = r.message; return }
  toast.success(editando.value ? 'Vista actualizada' : 'Vista agregada')
  cerrarForm()
  await cargar()
  emit('cambio')
}

async function toggle(v: SitioVista): Promise<void> {
  const r = await store.toggleVista(v.id)
  if (!r.ok) { toast.error(r.message); return }
  await cargar()
  emit('cambio')
}

async function eliminar(v: SitioVista): Promise<void> {
  if (!confirm(`¿Dejar de chequear «${v.nombre || v.ruta}»? Se borra su historial de chequeos.`)) return
  const r = await store.removeVista(v.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Vista eliminada')
  await cargar()
  emit('cambio')
}

onMounted(() => { void cargar() })
</script>

<template>
  <div class="ds-modal-backdrop" @click.self="emit('cerrar')">
    <div class="ds-modal max-w-2xl">
      <header class="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-ink">Vistas de {{ sitio.nombre }}</h2>
          <p class="text-xs text-ink-soft mt-0.5">
            Cada vista se chequea por separado y avisa por separado. El dominio y el certificado
            son del sitio, no de la ruta.
          </p>
        </div>
        <button class="row-action shrink-0" title="Cerrar" aria-label="Cerrar" @click="emit('cerrar')">
          <IonIcon :icon="closeOutline" class="text-[16px]" />
        </button>
      </header>

      <div class="px-5 py-4 max-h-[65vh] overflow-y-auto">
        <div v-if="cargando" class="space-y-2">
          <div v-for="i in 2" :key="i" class="ds-skeleton h-14"></div>
        </div>

        <ul v-else class="space-y-1.5">
          <li
            v-for="v in vistas" :key="v.id"
            class="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-line"
            :class="{ 'opacity-55': !v.activo }"
          >
            <span class="w-2 h-2 rounded-full shrink-0" :class="colorEstado(v.estado)" :title="ETIQUETA[v.estado]"></span>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-sm font-medium text-ink">{{ v.nombre || v.ruta }}</span>
                <span v-if="v.ruta === '/'" class="ds-badge-neutral">home</span>
                <span v-if="v.verificaMarcador" class="ds-badge-ok" title="Le exigimos el marcador del footer">nuestro</span>
                <span v-else class="ds-badge-neutral" title="Alcanza con que responda 2xx">de terceros</span>
                <span v-if="v.marcadorId" class="ds-badge-warn" :title="`Usa el marcador #${v.marcadorId} en vez del global`">
                  #{{ v.marcadorId }}
                </span>
                <span v-if="!v.activo" class="ds-badge-neutral">sin chequear</span>
              </div>
              <p class="text-2xs text-ink-faint font-mono truncate">{{ urlDe(v.ruta) }}</p>
              <p class="text-2xs text-ink-faint tnum">
                {{ ETIQUETA[v.estado] }}<template v-if="v.tiempoMs"> · {{ v.tiempoMs }} ms</template>
                <template v-if="v.ultimoChequeoAt"> · {{ fechaHora(v.ultimoChequeoAt) }}</template>
                <template v-else> · nunca se chequeó</template>
              </p>
            </div>

            <div class="flex items-center gap-0.5 shrink-0">
              <a class="row-action" :href="urlDe(v.ruta)" target="_blank" rel="noopener" title="Abrir" aria-label="Abrir">
                <IonIcon :icon="openOutline" class="text-[15px]" />
              </a>
              <template v-if="puedeEditar">
                <button class="row-action" title="Editar" aria-label="Editar" @click="abrirEdicion(v)">
                  <IonIcon :icon="createOutline" class="text-[15px]" />
                </button>
                <button class="row-action" :title="v.activo ? 'Dejar de chequear' : 'Volver a chequear'" aria-label="Activar o desactivar" @click="toggle(v)">
                  <IonIcon :icon="powerOutline" class="text-[15px]" />
                </button>
                <button class="row-action" title="Eliminar" aria-label="Eliminar" @click="eliminar(v)">
                  <IonIcon :icon="trashOutline" class="text-[15px]" />
                </button>
              </template>
            </div>
          </li>
        </ul>

        <button v-if="puedeEditar && !nueva && !editando" class="ds-btn-secondary h-8 mt-3" @click="abrirNueva">
          <IonIcon :icon="addOutline" class="text-[15px]" /> Agregar una vista
        </button>

        <!-- Formulario de alta/edición, en línea: es un formulario de cuatro campos y abrir
             otro modal encima del modal es peor que mostrarlo acá. -->
        <div v-if="nueva || editando" class="mt-3 p-3 rounded-lg border border-line bg-surface-2 space-y-3">
          <p class="text-xs font-semibold text-ink">{{ editando ? 'Editar la vista' : 'Vista nueva' }}</p>

          <div>
            <label class="ds-label" for="vista-ruta">Ruta</label>
            <input id="vista-ruta" v-model="form.ruta" class="ds-input h-9 font-mono" placeholder="/ecommerce" />
            <p class="ds-hint">Relativa al sitio. Se puede pegar la URL completa: se guarda solo la ruta.</p>
            <p class="text-2xs text-ink-faint font-mono mt-1">→ {{ urlDe(form.ruta) }}</p>
          </div>

          <div>
            <label class="ds-label" for="vista-nombre">Nombre (opcional)</label>
            <input id="vista-nombre" v-model="form.nombre" class="ds-input h-9" placeholder="Tienda" />
            <p class="ds-hint">Para los avisos. Si no hay, se usa la ruta.</p>
          </div>

          <label class="flex items-start gap-2 cursor-pointer select-none">
            <input v-model="form.verificaMarcador" type="checkbox" class="accent-accent mt-0.5" />
            <span class="text-xs text-ink">
              Esta vista la administramos nosotros
              <span class="block text-2xs text-ink-faint">
                Se le exige el marcador del footer. Sin esto alcanza con que responda 2xx —
                que es lo correcto para algo que no hicimos nosotros.
              </span>
            </span>
          </label>

          <div v-if="form.verificaMarcador">
            <label class="ds-label" for="vista-marcador">Id del marcador (opcional)</label>
            <input id="vista-marcador" v-model="form.marcadorId" class="ds-input h-9 font-mono" placeholder="usa el global" />
            <p class="ds-hint">
              Solo si esta vista lleva un id distinto del configurado en Configuración → Negocio.
              Vacío = el global.
            </p>
          </div>

          <p v-if="formError" class="ds-error">{{ formError }}</p>

          <div class="flex flex-wrap gap-2">
            <button class="ds-btn-primary h-8" :disabled="guardando || !form.ruta" @click="guardar">
              <IonIcon :icon="checkmarkOutline" class="text-[15px]" />
              {{ guardando ? 'Guardando…' : 'Guardar' }}
            </button>
            <button class="ds-btn-ghost h-8" @click="cerrarForm">Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row-action {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px;
  color: rgb(var(--s-ink-faint));
  transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover:not(:disabled) { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
.row-action:disabled { opacity: 0.45; }
</style>
