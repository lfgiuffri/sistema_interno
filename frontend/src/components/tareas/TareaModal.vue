<script setup lang="ts">
/**
 * Modal dual de tarea (regla del legado §1.3.e):
 *  - Alta/edición RÁPIDA: nombre + asignado + vencimiento + prioridad. La edición rápida
 *    NO manda descripción ni estado (PATCH /rapida — no destruye).
 *  - Edición COMPLETA: todo + editor TipTap + fechas + historial + adjuntos + tiempo.
 * La tarea no se mueve de lista desde acá (acción "mover" aparte).
 */
import { ref, computed, watch, nextTick } from 'vue'
import { IonIcon, alertController } from '@ionic/vue'
import {
  timeOutline, attachOutline, downloadOutline, trashOutline, expandOutline,
  chatbubbleOutline, sendOutline,
} from 'ionicons/icons'
import { useTareasStore, ESTADOS_TAREA, PRIORIDADES, type TareaDetalle } from '@/stores/tareas'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fecha as fmtFecha, fechaHora, duracion } from '@/composables/useFormato'
import { hidratarImagenes, descargarArchivo } from '@/composables/useArchivosProtegidos'
import DescripcionEditor from './DescripcionEditor.vue'

const props = defineProps<{
  open: boolean
  listaId: number
  /** null = alta; id = edición (carga el detalle). */
  tareaId: number | null
  asignables: Array<{ id: number; nombre: string }>
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const tareasStore = useTareasStore()
const meStore = useMeStore()
const toast = useToast()

const modoCompleto = ref(false)
const detalle = ref<TareaDetalle | null>(null)
const cargando = ref(false)
const guardando = ref(false)
const formError = ref('')
const subiendoAdjunto = ref(false)
const comentarioNuevo = ref('')
const comentando = ref(false)

const form = ref({
  nombre: '',
  asignadoA: 0,
  fechaVencimiento: '',
  prioridad: 'verde',
  estado: 'abierta',
  fechaInicio: '',
  descripcion: '',
})

const esEdicion = computed(() => props.tareaId !== null)
const abierto = computed(() => props.open)
useEscapeToClose(abierto, () => emit('close'))

const puedeAsignarOtros = computed(() => meStore.can('tareas:asignar'))
// Sin tareas:asignar solo puede asignarse a sí mismo (o dejar sin asignar).
const opcionesAsignado = computed(() => {
  if (puedeAsignarOtros.value) return props.asignables
  const yo = props.asignables.find(a => a.id === meStore.user?.id)
  const actual = detalle.value?.asignadoA
    ? props.asignables.find(a => a.id === detalle.value?.asignadoA)
    : null
  return [...new Set([yo, actual].filter(Boolean))] as Array<{ id: number; nombre: string }>
})

watch(() => props.open, async (v) => {
  if (!v) return
  formError.value = ''
  detalle.value = null
  modoCompleto.value = false
  if (props.tareaId === null) {
    // Alta rápida preasignada a mí, prioridad verde (regla del legado).
    form.value = {
      nombre: '', asignadoA: meStore.user?.id ?? 0, fechaVencimiento: '',
      prioridad: 'verde', estado: 'abierta', fechaInicio: '', descripcion: '',
    }
    return
  }
  cargando.value = true
  const d = await tareasStore.fetchTarea(props.tareaId)
  cargando.value = false
  if (!d) { toast.error('Tarea no encontrada'); emit('close'); return }
  detalle.value = d
  form.value = {
    nombre: d.nombre,
    asignadoA: d.asignadoA ?? 0,
    fechaVencimiento: d.fechaVencimiento ?? '',
    prioridad: d.prioridad,
    estado: d.estado,
    fechaInicio: d.fechaInicio ?? '',
    descripcion: d.descripcion ?? '',
  }
})

// Al expandir a modo completo, hidratar las imágenes protegidas del historial visual no
// hace falta (el editor las resuelve solo); el contenedor de adjuntos es reactivo.
const descripcionRef = ref<HTMLElement | null>(null)
watch(modoCompleto, async () => { await nextTick(); await hidratarImagenes(descripcionRef.value) })

async function guardar(): Promise<void> {
  if (!form.value.nombre.trim() || guardando.value) return
  guardando.value = true
  formError.value = ''
  let r
  const base = {
    nombre: form.value.nombre.trim(),
    asignadoA: form.value.asignadoA || 0,
    fechaVencimiento: form.value.fechaVencimiento || '',
    prioridad: form.value.prioridad,
  }
  if (!esEdicion.value) {
    r = await tareasStore.createTarea({
      listaId: props.listaId,
      ...base,
      ...(modoCompleto.value ? { estado: form.value.estado, fechaInicio: form.value.fechaInicio || '', descripcion: form.value.descripcion } : {}),
    })
  } else if (modoCompleto.value) {
    r = await tareasStore.updateTarea(props.tareaId as number, {
      ...base,
      estado: form.value.estado,
      fechaInicio: form.value.fechaInicio || '',
      descripcion: form.value.descripcion,
    })
  } else {
    // Rápida: NUNCA manda descripción/estado.
    r = await tareasStore.updateRapida(props.tareaId as number, base)
  }
  guardando.value = false
  if (!r.ok) { formError.value = r.message; return }
  toast.success(esEdicion.value ? 'Tarea actualizada' : 'Tarea creada')
  emit('saved')
  emit('close')
}

async function subirAdjunto(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.tareaId) return
  subiendoAdjunto.value = true
  const r = await tareasStore.subirArchivo(file, props.tareaId)
  subiendoAdjunto.value = false
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Adjunto subido')
  detalle.value = await tareasStore.fetchTarea(props.tareaId)
}

async function comentar(): Promise<void> {
  if (!comentarioNuevo.value.trim() || !props.tareaId || comentando.value) return
  comentando.value = true
  const r = await tareasStore.addComentario(props.tareaId, comentarioNuevo.value.trim())
  comentando.value = false
  if (!r.ok) { toast.error(r.message); return }
  comentarioNuevo.value = ''
  detalle.value = await tareasStore.fetchTarea(props.tareaId)
}

async function borrarComentario(id: number): Promise<void> {
  const r = await tareasStore.removeComentario(id)
  if (!r.ok) { toast.error(r.message); return }
  if (props.tareaId) detalle.value = await tareasStore.fetchTarea(props.tareaId)
}

async function borrarAdjunto(id: number): Promise<void> {
  const alert = await alertController.create({
    header: 'Eliminar adjunto',
    message: '¿Eliminar este archivo? No se puede deshacer.',
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Eliminar', role: 'destructive',
        handler: async () => {
          const r = await tareasStore.removeArchivo(id)
          if (!r.ok) { toast.error(r.message); return }
          if (props.tareaId) detalle.value = await tareasStore.fetchTarea(props.tareaId)
        },
      },
    ],
  })
  await alert.present()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ds-modal-backdrop" @click.self="emit('close')">
      <div class="ds-modal" :class="modoCompleto ? 'max-w-2xl' : 'max-w-md'" role="dialog" aria-modal="true" :aria-label="esEdicion ? 'Editar tarea' : 'Nueva tarea'">
        <header class="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 class="text-base font-semibold text-ink">{{ esEdicion ? 'Editar tarea' : 'Nueva tarea' }}</h2>
            <p v-if="detalle?.lista" class="text-2xs text-ink-faint mt-0.5">Lista: {{ detalle.lista.nombre }} (para moverla usá la acción «Mover»)</p>
          </div>
          <button v-if="!modoCompleto" type="button" class="ds-btn-ghost h-7 px-2 text-xs" @click="modoCompleto = true">
            <IonIcon :icon="expandOutline" class="text-[13px]" />
            Modo completo
          </button>
        </header>

        <div v-if="cargando" class="space-y-2"><div v-for="i in 4" :key="i" class="ds-skeleton h-9"></div></div>

        <form v-else class="space-y-3" @submit.prevent="guardar">
          <div>
            <label class="ds-label" for="tm-nombre">Nombre</label>
            <input id="tm-nombre" v-model="form.nombre" class="ds-input" type="text" required maxlength="200" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="ds-label" for="tm-asignado">Asignada a</label>
              <select id="tm-asignado" v-model.number="form.asignadoA" class="ds-input">
                <option :value="0">— Sin asignar —</option>
                <option v-for="a in opcionesAsignado" :key="a.id" :value="a.id">
                  {{ a.nombre }}{{ a.id === meStore.user?.id ? ' (vos)' : '' }}
                </option>
              </select>
              <p v-if="!puedeAsignarOtros" class="ds-hint">Sin permiso para asignar a otros.</p>
            </div>
            <div>
              <label class="ds-label" for="tm-venc">Vencimiento</label>
              <input id="tm-venc" v-model="form.fechaVencimiento" class="ds-input" type="date" />
            </div>
          </div>

          <div>
            <span class="ds-label">Prioridad</span>
            <div class="flex gap-1.5" role="radiogroup" aria-label="Prioridad">
              <button
                v-for="(meta, key) in PRIORIDADES"
                :key="key"
                type="button"
                class="pill"
                role="radio"
                :aria-checked="form.prioridad === key"
                :class="{ 'pill-activa': form.prioridad === key }"
                :style="{ '--c': meta.color }"
                @click="form.prioridad = key as string"
              >
                {{ meta.label }}
              </button>
            </div>
          </div>

          <template v-if="modoCompleto">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <span class="ds-label">Estado</span>
                <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Estado">
                  <button
                    v-for="(meta, key) in ESTADOS_TAREA"
                    :key="key"
                    type="button"
                    class="pill"
                    role="radio"
                    :aria-checked="form.estado === key"
                    :class="{ 'pill-activa': form.estado === key }"
                    :style="{ '--c': meta.color }"
                    @click="form.estado = key as string"
                  >
                    {{ meta.label }}
                  </button>
                </div>
              </div>
              <div>
                <label class="ds-label" for="tm-inicio">Fecha de inicio</label>
                <input id="tm-inicio" v-model="form.fechaInicio" class="ds-input" type="date" />
              </div>
            </div>

            <div>
              <span class="ds-label">Descripción</span>
              <DescripcionEditor v-model="form.descripcion" />
            </div>

            <!-- Adjuntos (solo en edición: la tarea tiene que existir) -->
            <div v-if="esEdicion && detalle">
              <div class="flex items-center justify-between">
                <span class="ds-label !mb-0">Adjuntos</span>
                <label class="ds-btn-ghost h-7 px-2 text-xs cursor-pointer">
                  <IonIcon :icon="attachOutline" class="text-[13px]" />
                  {{ subiendoAdjunto ? 'Subiendo…' : 'Adjuntar archivo' }}
                  <input type="file" class="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" @change="subirAdjunto" />
                </label>
              </div>
              <div v-if="detalle.archivos.length" class="mt-1 divide-y divide-line-soft border border-line rounded-lg">
                <div v-for="a in detalle.archivos" :key="a.id" class="flex items-center gap-2 px-3 h-9">
                  <IonIcon :icon="attachOutline" class="text-[13px] text-ink-faint shrink-0" />
                  <span class="flex-1 text-xs text-ink truncate">{{ a.nombreOriginal }}</span>
                  <span class="text-2xs text-ink-faint tnum shrink-0">{{ (a.size / 1024).toFixed(0) }} KB</span>
                  <button type="button" class="row-action" title="Descargar" aria-label="Descargar" @click="descargarArchivo(a.url, a.nombreOriginal)">
                    <IonIcon :icon="downloadOutline" class="text-[13px]" />
                  </button>
                  <button type="button" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar adjunto" @click="borrarAdjunto(a.id)">
                    <IonIcon :icon="trashOutline" class="text-[13px]" />
                  </button>
                </div>
              </div>
              <p v-else class="text-2xs text-ink-faint mt-1">Sin adjuntos. Acepta PDF, Office, CSV, TXT y ZIP (máx. 15 MB).</p>
            </div>

            <!-- Historial + tiempo (solo edición) -->
            <div v-if="esEdicion && detalle && detalle.historial.length">
              <div class="flex items-center justify-between">
                <span class="ds-label !mb-0">Historial de estados</span>
                <span class="text-2xs text-ink-faint tnum flex items-center gap-1">
                  <IonIcon :icon="timeOutline" class="text-[12px]" />
                  Trabajo: {{ detalle.tiempoTrabajado ? duracion(detalle.tiempoTrabajado) : 'sin datos' }}
                </span>
              </div>
              <div class="mt-1 border border-line rounded-lg divide-y divide-line-soft max-h-40 overflow-y-auto">
                <div v-for="h in detalle.historial" :key="h.id" class="flex items-center gap-2 px-3 h-8 text-xs">
                  <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: ESTADOS_TAREA[h.estadoNuevo]?.color }"></span>
                  <span class="text-ink">
                    {{ h.estadoAnterior ? `${ESTADOS_TAREA[h.estadoAnterior]?.label ?? h.estadoAnterior} → ` : 'Creada como ' }}{{ ESTADOS_TAREA[h.estadoNuevo]?.label ?? h.estadoNuevo }}
                  </span>
                  <span class="flex-1"></span>
                  <span class="text-ink-faint">{{ h.usuario ?? 'usuario dado de baja' }}</span>
                  <span class="text-ink-faint tnum">{{ fechaHora(h.fecha) }}</span>
                </div>
              </div>
            </div>

            <!-- Comentarios (mejora §10.9: hilo simple con menciones @username) -->
            <div v-if="esEdicion && detalle">
              <span class="ds-label flex items-center gap-1.5">
                <IonIcon :icon="chatbubbleOutline" class="text-[13px]" />
                Comentarios
              </span>
              <div v-if="detalle.comentarios.length" class="border border-line rounded-lg divide-y divide-line-soft max-h-48 overflow-y-auto mb-2">
                <div v-for="c in detalle.comentarios" :key="c.id" class="px-3 py-2 group">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-medium text-ink">{{ c.usuario }}</span>
                    <span class="text-2xs text-ink-faint tnum">{{ fechaHora(c.fecha) }}</span>
                    <span class="flex-1"></span>
                    <button
                      v-if="c.userId === meStore.user?.id"
                      type="button" class="row-action opacity-0 group-hover:opacity-100 hover:!text-danger"
                      title="Eliminar comentario" aria-label="Eliminar comentario"
                      @click="borrarComentario(c.id)"
                    >
                      <IonIcon :icon="trashOutline" class="text-[12px]" />
                    </button>
                  </div>
                  <p class="text-xs text-ink-soft whitespace-pre-wrap mt-0.5">{{ c.texto }}</p>
                </div>
              </div>
              <div class="flex gap-2">
                <input
                  v-model="comentarioNuevo"
                  class="ds-input h-8 flex-1 text-xs"
                  type="text"
                  placeholder="Comentar… (@usuario para mencionar)"
                  maxlength="2000"
                  @keyup.enter="comentar"
                />
                <button type="button" class="ds-btn-secondary h-8 px-2.5" :disabled="!comentarioNuevo.trim() || comentando" aria-label="Enviar comentario" @click="comentar">
                  <IonIcon :icon="sendOutline" class="text-[13px]" />
                </button>
              </div>
            </div>

            <p v-if="detalle" class="text-2xs text-ink-faint">
              Creada por {{ detalle.creador ? `${detalle.creador.name} ${detalle.creador.lastName}` : '—' }} el {{ fmtFecha(detalle.createdAt) }}
            </p>
          </template>

          <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>

          <footer class="flex justify-end gap-2 pt-1">
            <button type="button" class="ds-btn-secondary" @click="emit('close')">Cancelar</button>
            <button type="submit" class="ds-btn-primary" :disabled="!form.nombre.trim() || guardando">
              {{ guardando ? 'Guardando…' : (esEdicion ? 'Guardar cambios' : 'Crear tarea') }}
            </button>
          </footer>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pill {
  height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 500;
  color: var(--c); background: color-mix(in srgb, var(--c) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 25%, transparent);
  transition: transform 0.1s ease;
}
.pill:active { transform: scale(0.97); }
.pill-activa {
  background: var(--c); color: white; border-color: var(--c);
}
.row-action {
  display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
</style>
