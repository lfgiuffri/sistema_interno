<script setup lang="ts">
/**
 * Modal de tarea — MISMA pantalla para alta y edición (antes el alta era un formulario
 * recortado y había que "expandir" para ver descripción, adjuntos y comentarios).
 *
 * Layout de dos columnas para que no quede un modal larguísimo:
 *  - Izquierda: los campos de la tarea (nombre, asignado, fechas, prioridad, estado,
 *    descripción y adjuntos).
 *  - Derecha: la actividad (comentarios e historial de estados), que es lo que más crece.
 *
 * Adjuntar durante el ALTA: el archivo se sube antes de que exista la tarea (queda huérfano
 * en el índice) y el POST lo liga con `archivoIds`. Si se cancela el alta, el GC diario
 * borra los huérfanos > 48 h.
 */
import { ref, computed, watch, nextTick } from 'vue'
import { IonIcon, alertController } from '@ionic/vue'
import {
  timeOutline, attachOutline, downloadOutline, trashOutline,
  chatbubbleOutline, sendOutline,
} from 'ionicons/icons'
import { useTareasStore, ESTADOS_TAREA, PRIORIDADES, type TareaDetalle } from '@/stores/tareas'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fecha as fmtFecha, fechaHora, duracion } from '@/composables/useFormato'
import { hidratarImagenes, descargarArchivo } from '@/composables/useArchivosProtegidos'
import DescripcionEditor from './DescripcionEditor.vue'
import ZonaAdjuntos from '@/components/shared/ZonaAdjuntos.vue'

const props = defineProps<{
  open: boolean
  listaId: number
  /** Nombre de la lista donde se está creando (contexto: en el modal no se ve dónde cae). */
  listaNombre?: string
  /** Listas del espacio: al crear se puede repetir la tarea en varias de una vez. */
  listasDelEspacio?: Array<{ id: number; nombre: string }>
  /** null = alta; id = edición (carga el detalle). */
  tareaId: number | null
  asignables: Array<{ id: number; nombre: string; username: string }>
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const tareasStore = useTareasStore()
const meStore = useMeStore()
const toast = useToast()

/** Adjunto ya subido (de la tarea, o pendiente de ligar si es un alta). */
interface AdjuntoVista { id: number; nombreOriginal: string; size: number; url: string }

const detalle = ref<TareaDetalle | null>(null)
const cargando = ref(false)
const guardando = ref(false)
const formError = ref('')
const comentarioNuevo = ref('')
const comentando = ref(false)
/** Adjuntos subidos en un ALTA: viven acá hasta que el POST los liga. */
const adjuntosPendientes = ref<AdjuntoVista[]>([])

/**
 * Listas EXTRA donde repetir la tarea (solo al crear). La lista actual siempre va incluida y
 * no se puede destildar: es donde estás parado.
 */
const listasExtra = ref<number[]>([])

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

/** Adjuntos a mostrar: los de la tarea (edición) o los pendientes (alta). */
const adjuntos = computed<AdjuntoVista[]>(() =>
  esEdicion.value ? (detalle.value?.archivos ?? []) : adjuntosPendientes.value,
)

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

const descripcionRef = ref<HTMLElement | null>(null)

watch(() => props.open, async (v) => {
  if (!v) return
  formError.value = ''
  detalle.value = null
  adjuntosPendientes.value = []
  listasExtra.value = []
  if (props.tareaId === null) {
    // Alta preasignada a mí, prioridad verde (regla del legado).
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
  await nextTick()
  await hidratarImagenes(descripcionRef.value)
})

async function guardar(): Promise<void> {
  if (!form.value.nombre.trim() || guardando.value) return
  guardando.value = true
  formError.value = ''

  const base = {
    nombre: form.value.nombre.trim(),
    asignadoA: form.value.asignadoA || 0,
    fechaVencimiento: form.value.fechaVencimiento || '',
    prioridad: form.value.prioridad,
    estado: form.value.estado,
    fechaInicio: form.value.fechaInicio || '',
    descripcion: form.value.descripcion,
  }

  const r = esEdicion.value
    ? await tareasStore.updateTarea(props.tareaId as number, base)
    : await tareasStore.createTarea({
      // Con listas extra se manda `listaIds` (la actual + las elegidas) y el backend crea una
      // tarea independiente en cada una. Sin extras, el alta normal de una sola lista.
      ...(listasExtra.value.length
        ? { listaIds: [props.listaId, ...listasExtra.value] }
        : { listaId: props.listaId }),
      ...base,
      // Adjuntos subidos durante el alta: el backend los liga a la tarea nueva.
      ...(adjuntosPendientes.value.length ? { archivoIds: adjuntosPendientes.value.map(a => a.id) } : {}),
    })

  guardando.value = false
  if (!r.ok) { formError.value = r.message; return }
  toast.success(esEdicion.value ? 'Tarea actualizada' : 'Tarea creada')
  emit('saved')
  emit('close')
}

/**
 * Texto legible de una entrada del historial.
 *
 * El valor crudo no sirve: un cambio de asignado guarda el id del usuario y uno de estado
 * guarda la clave interna. Acá se traducen a lo que el usuario ve en pantalla.
 * @param h - Entrada de la bitácora.
 * @returns Frase del tipo «Prioridad: Baja → Urgente».
 */
function describirCambio(h: { campo: string; campoLabel: string; valorAnterior: string | null; valorNuevo: string | null }): string {
  const legible = (v: string | null): string => {
    if (v === null || v === '') return '—'
    if (h.campo === 'estado') return ESTADOS_TAREA[v]?.label ?? v
    if (h.campo === 'prioridad') return PRIORIDADES[v]?.label ?? v
    if (h.campo === 'asignadoA') return props.asignables.find(a => a.id === Number(v))?.nombre ?? `usuario #${v}`
    return v
  }
  // Creación: no hay valor anterior que mostrar.
  if (h.valorAnterior === null && h.campo === 'estado') return `Creada como ${legible(h.valorNuevo)}`
  if (h.campo === 'descripcion') return 'Se modificó la descripción'
  return `${h.campoLabel}: ${legible(h.valorAnterior)} → ${legible(h.valorNuevo)}`
}

async function subirAdjunto(file: File): Promise<{ ok: boolean; message: string }> {
  // `destino: 'adjunto'` es lo que hace que una IMAGEN quede listada como adjunto en vez de
  // irse al cuerpo como contenido del editor. En el alta sube sin tareaId (queda huérfano
  // hasta que se guarde la tarea, y si se cancela lo limpia el GC diario).
  const r = await tareasStore.subirArchivo(file, props.tareaId ?? undefined, 'adjunto')
  // Creando, el registro se guarda acá: todavía no hay tarea que releer.
  if (r.ok && !esEdicion.value && r.data) adjuntosPendientes.value.push(r.data as unknown as AdjuntoVista)
  return r
}

/**
 * Terminó una tanda de subidas: refresca la lista y avisa lo que pasó.
 * @param r - Cuántos entraron y qué falló.
 */
async function adjuntosListos(r: { subidos: number; errores: string[] }): Promise<void> {
  if (r.subidos) {
    toast.success(r.subidos === 1 ? 'Adjunto subido' : `${r.subidos} adjuntos subidos`)
    if (esEdicion.value) detalle.value = await tareasStore.fetchTarea(props.tareaId as number)
  }
  // Un archivo rechazado (tamaño, extensión) se dice con su nombre: si no, no se sabe cuál fue.
  r.errores.forEach(e => toast.error(e))
}

// ── Autocompletado de menciones (@) en el comentario ──
const comentarioRef = ref<HTMLInputElement | null>(null)
const mencionAbierta = ref(false)
const mencionQuery = ref('')
const mencionIndex = ref(0)

/** Candidatos a mencionar: los asignables filtrados por nombre o username. */
const candidatosMencion = computed(() => {
  const q = mencionQuery.value.toLowerCase()
  const lista = props.asignables.filter(a =>
    !q || a.username?.toLowerCase().includes(q) || a.nombre.toLowerCase().includes(q),
  )
  return lista.slice(0, 6)
})

/**
 * Detecta si el cursor está escribiendo una mención (`@algo` pegado al arroba) y abre
 * la lista. El token se busca hacia atrás desde el cursor, así funciona también al
 * corregir en el medio del texto.
 */
function onComentarioInput(): void {
  const el = comentarioRef.value
  if (!el) return
  const hasta = comentarioNuevo.value.slice(0, el.selectionStart ?? comentarioNuevo.value.length)
  const m = hasta.match(/(?:^|\s)@([a-zA-Z0-9._-]*)$/)
  if (!m) { mencionAbierta.value = false; return }
  mencionQuery.value = m[1]
  mencionIndex.value = 0
  mencionAbierta.value = true
}

/**
 * Reemplaza el token que se está escribiendo por `@username ` (el username exacto es lo
 * que el backend busca para notificar: escribir el nombre visible no menciona a nadie).
 * @param u - Usuario elegido.
 */
function elegirMencion(u: { username: string }): void {
  const el = comentarioRef.value
  const cursor = el?.selectionStart ?? comentarioNuevo.value.length
  const antes = comentarioNuevo.value.slice(0, cursor).replace(/@([a-zA-Z0-9._-]*)$/, `@${u.username} `)
  const despues = comentarioNuevo.value.slice(cursor)
  comentarioNuevo.value = antes + despues
  mencionAbierta.value = false
  void nextTick(() => {
    el?.focus()
    const pos = antes.length
    el?.setSelectionRange(pos, pos)
  })
}

/** Teclado sobre el input: con la lista abierta, las flechas y Enter la manejan a ella. */
function onComentarioKeydown(e: KeyboardEvent): void {
  if (!mencionAbierta.value || !candidatosMencion.value.length) {
    if (e.key === 'Enter') { e.preventDefault(); void comentar() }
    return
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); mencionIndex.value = (mencionIndex.value + 1) % candidatosMencion.value.length }
  else if (e.key === 'ArrowUp') { e.preventDefault(); mencionIndex.value = (mencionIndex.value - 1 + candidatosMencion.value.length) % candidatosMencion.value.length }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); elegirMencion(candidatosMencion.value[mencionIndex.value]) }
  else if (e.key === 'Escape') { e.preventDefault(); mencionAbierta.value = false }
}

async function comentar(): Promise<void> {
  if (!comentarioNuevo.value.trim() || !props.tareaId || comentando.value) return
  comentando.value = true
  const r = await tareasStore.addComentario(props.tareaId, comentarioNuevo.value.trim())
  comentando.value = false
  if (!r.ok) { toast.error(r.message); return }
  comentarioNuevo.value = ''
  mencionAbierta.value = false
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
          if (esEdicion.value) detalle.value = await tareasStore.fetchTarea(props.tareaId as number)
          else adjuntosPendientes.value = adjuntosPendientes.value.filter(a => a.id !== id)
        },
      },
    ],
  })
  await alert.present()
}
</script>

<template>
  <Teleport defer to="ion-app">
    <div v-if="open" class="ds-modal-backdrop" @click.self="emit('close')">
      <div class="ds-modal ds-modal-xl" role="dialog" aria-modal="true" :aria-label="esEdicion ? 'Editar tarea' : 'Nueva tarea'">
        <header class="mb-3">
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-ink">{{ esEdicion ? 'Editar tarea' : 'Nueva tarea' }}</h2>
            <p v-if="listaNombre" class="text-2xs text-ink-faint truncate">en {{ listaNombre }}</p>
          </div>
          <p v-if="detalle?.lista" class="text-2xs text-ink-faint mt-0.5">
            Lista: {{ detalle.lista.nombre }} (para moverla usá la acción «Mover»)
          </p>
        </header>

        <div v-if="cargando" class="space-y-2"><div v-for="i in 5" :key="i" class="ds-skeleton h-9"></div></div>

        <form v-else @submit.prevent="guardar">
          <div class="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-x-5 gap-y-3">

            <!-- ── Columna izquierda: la tarea ── -->
            <div class="space-y-3 min-w-0">
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

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <span class="ds-label">Prioridad</span>
                  <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Prioridad">
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
                <div>
                  <label class="ds-label" for="tm-inicio">Fecha de inicio</label>
                  <input id="tm-inicio" v-model="form.fechaInicio" class="ds-input" type="date" />
                </div>
              </div>

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

              <!-- Repetir en varias listas: solo al crear. Editando, mover es otra acción. -->
              <div v-if="!esEdicion && (listasDelEspacio?.length ?? 0) > 1">
                <span class="ds-label">Crear también en</span>
                <div class="flex flex-wrap gap-1.5">
                  <label
                    v-for="l in listasDelEspacio!.filter(x => x.id !== listaId)"
                    :key="l.id"
                    class="lista-chip"
                    :class="{ 'lista-chip-on': listasExtra.includes(l.id) }"
                  >
                    <input v-model="listasExtra" type="checkbox" :value="l.id" class="sr-only" />
                    {{ l.nombre }}
                  </label>
                </div>
                <p v-if="listasExtra.length" class="ds-hint mt-1">
                  Se van a crear {{ listasExtra.length + 1 }} tareas independientes, una por lista,
                  cada una con su copia de los adjuntos.
                </p>
              </div>

              <div ref="descripcionRef">
                <span class="ds-label">Descripción</span>
                <DescripcionEditor v-model="form.descripcion" />
              </div>

              <!-- Adjuntos: también en el alta (se ligan al guardar) -->
              <div>
                <span class="ds-label">Adjuntos</span>
                <ZonaAdjuntos
                  class="mb-2"
                  :subir="subirAdjunto"
                  ayuda="Imágenes, PDF, Office, CSV, TXT y ZIP. Hasta 5 MB las imágenes y 15 MB el resto."
                  @listo="adjuntosListos"
                />
                <div v-if="adjuntos.length" class="mt-1 divide-y divide-line-soft border border-line rounded-lg">
                  <div v-for="a in adjuntos" :key="a.id" class="flex items-center gap-2 px-3 h-9">
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
                <p v-else class="text-2xs text-ink-faint mt-1">Sin adjuntos todavía.</p>
                <p v-if="!esEdicion && adjuntos.length" class="text-2xs text-ink-faint mt-1">
                  Se van a asociar a la tarea cuando la crees.
                </p>
              </div>
            </div>

            <!-- ── Columna derecha: actividad ── -->
            <div class="space-y-3 min-w-0 lg:border-l lg:border-line-soft lg:pl-5">
              <!-- Comentarios -->
              <div>
                <span class="ds-label flex items-center gap-1.5">
                  <IonIcon :icon="chatbubbleOutline" class="text-[13px]" />
                  Comentarios
                </span>

                <template v-if="esEdicion && detalle">
                  <div v-if="detalle.comentarios.length" class="border border-line rounded-lg divide-y divide-line-soft max-h-[22rem] overflow-y-auto mb-2">
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
                  <p v-else class="text-2xs text-ink-faint mb-2">Todavía no hay comentarios.</p>

                  <div class="flex gap-2 relative">
                    <!-- Desplegable de menciones: se abre al tipear «@». -->
                    <div
                      v-if="mencionAbierta && candidatosMencion.length"
                      class="absolute bottom-full left-0 mb-1 w-64 z-10 border border-line rounded-lg bg-surface shadow-lg overflow-hidden"
                      role="listbox"
                      aria-label="Mencionar a"
                    >
                      <button
                        v-for="(u, i) in candidatosMencion"
                        :key="u.id"
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                        :class="i === mencionIndex ? 'bg-accent-soft text-accent-ink' : 'hover:bg-surface-2'"
                        role="option"
                        :aria-selected="i === mencionIndex"
                        @mousedown.prevent="elegirMencion(u)"
                        @mouseenter="mencionIndex = i"
                      >
                        <span class="font-medium truncate">{{ u.nombre }}</span>
                        <span class="text-ink-faint">@{{ u.username }}</span>
                      </button>
                    </div>

                    <input
                      ref="comentarioRef"
                      v-model="comentarioNuevo"
                      class="ds-input h-8 flex-1 text-xs"
                      type="text"
                      placeholder="Comentar… (escribí @ para mencionar)"
                      maxlength="2000"
                      autocomplete="off"
                      @input="onComentarioInput"
                      @keydown="onComentarioKeydown"
                      @blur="mencionAbierta = false"
                    />
                    <button type="button" class="ds-btn-secondary h-8 px-2.5" :disabled="!comentarioNuevo.trim() || comentando" aria-label="Enviar comentario" @click="comentar">
                      <IonIcon :icon="sendOutline" class="text-[13px]" />
                    </button>
                  </div>
                </template>

                <p v-else class="text-2xs text-ink-faint">
                  Vas a poder comentar (y mencionar con @usuario) apenas crees la tarea.
                </p>
              </div>

              <!-- Historial: TODOS los cambios, no solo los de estado -->
              <div v-if="esEdicion && detalle && detalle.historial.length">
                <div class="flex items-center justify-between">
                  <span class="ds-label !mb-0">Historial de cambios</span>
                  <span class="text-2xs text-ink-faint tnum flex items-center gap-1">
                    <IonIcon :icon="timeOutline" class="text-[12px]" />
                    {{ detalle.tiempoTrabajado ? duracion(detalle.tiempoTrabajado) : 'sin datos' }}
                  </span>
                </div>
                <div class="mt-1 border border-line rounded-lg divide-y divide-line-soft max-h-52 overflow-y-auto">
                  <div v-for="h in detalle.historial" :key="h.id" class="flex items-start gap-2 px-3 py-1.5 text-xs">
                    <span
                      class="w-2 h-2 rounded-full shrink-0 mt-1.5"
                      :style="{ background: h.campo === 'estado' ? (ESTADOS_TAREA[h.valorNuevo ?? '']?.color ?? 'rgb(var(--s-line))') : 'rgb(var(--s-line))' }"
                    ></span>
                    <div class="min-w-0 flex-1">
                      <p class="text-ink">{{ describirCambio(h) }}</p>
                      <p class="text-2xs text-ink-faint tnum">
                        {{ h.usuario ?? 'usuario dado de baja' }} · {{ fechaHora(h.fecha) }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <p v-if="detalle" class="text-2xs text-ink-faint">
                Creada por {{ detalle.creador ? `${detalle.creador.name} ${detalle.creador.lastName}` : '—' }} el {{ fmtFecha(detalle.createdAt) }}
              </p>
            </div>
          </div>

          <p v-if="formError" class="ds-error mt-3" role="alert">{{ formError }}</p>

          <footer class="flex justify-end gap-2 pt-4 mt-3 border-t border-line-soft">
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
.lista-chip {
  display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
  border: 1px solid rgb(var(--s-line)); background: rgb(var(--s-surface));
  font-size: 0.75rem; color: rgb(var(--s-ink-soft)); cursor: pointer; user-select: none;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.lista-chip:hover { background: rgb(var(--s-surface-2)); }
.lista-chip-on {
  background: rgb(var(--s-accent-soft)); border-color: rgb(var(--s-accent) / 0.35);
  color: rgb(var(--s-accent-ink)); font-weight: 500;
}

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
