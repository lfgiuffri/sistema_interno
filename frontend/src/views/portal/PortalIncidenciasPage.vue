<script setup lang="ts">
/**
 * Portal del cliente: sus incidencias y el alta de una nueva.
 *
 * El listado muestra TODAS —lo pendiente arriba y las terminadas al fondo, orden que pone el
 * backend— porque para el cliente el historial es parte del valor: puede ver qué reportó y
 * cómo terminó.
 *
 * El estado se muestra pero NO se toca: lo mueve el equipo. No hay ningún control para
 * cambiarlo, y el backend tampoco expone la ruta en el portal.
 */
import { ref, computed, onMounted } from 'vue'
import { IonPage, IonContent, IonIcon } from '@ionic/vue'
import { addOutline, closeOutline, documentAttachOutline, chevronDownOutline } from 'ionicons/icons'
import { usePortalAuthStore } from '@/stores/portal/auth'
import {
  usePortalIncidenciasStore, ESTADOS_INCIDENCIA, ESTADOS_TERMINADOS, type Incidencia,
} from '@/stores/portal/incidencias'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import ZonaAdjuntos from '@/components/shared/ZonaAdjuntos.vue'
import PortalHeader from '@/components/portal/PortalHeader.vue'
import { fecha as fmtFecha } from '@/composables/useFormato'

const auth = usePortalAuthStore()
const store = usePortalIncidenciasStore()
const toast = useToast()

const modal = ref(false)
const guardando = ref(false)
const formError = ref('')
const form = ref<{ titulo: string; descripcion: string; servicioId: number | 0 }>({
  titulo: '', descripcion: '', servicioId: 0,
})
/** Adjuntos ya subidos, a la espera de que se guarde la incidencia. */
const adjuntos = ref<Array<{ id: number; nombreOriginal: string | null }>>([])
useEscapeToClose(modal, () => { modal.value = false })

/** Detalle abierto (acordeón): el cliente no necesita otra pantalla para leer tres campos. */
const abierta = ref<number | null>(null)
const detalles = ref<Record<number, Incidencia>>({})

const pendientes = computed(() => store.rows.filter(i => !ESTADOS_TERMINADOS.includes(i.estado)))
const terminadas = computed(() => store.rows.filter(i => ESTADOS_TERMINADOS.includes(i.estado)))

async function abrirDetalle(i: Incidencia): Promise<void> {
  if (abierta.value === i.id) { abierta.value = null; return }
  abierta.value = i.id
  if (!detalles.value[i.id]) {
    const d = await store.fetchIncidencia(i.id)
    if (d) detalles.value = { ...detalles.value, [i.id]: d }
  }
}

function abrirModal(): void {
  form.value = { titulo: '', descripcion: '', servicioId: 0 }
  adjuntos.value = []
  formError.value = ''
  modal.value = true
}

/** Sube un adjunto suelto. Se liga a la incidencia recién al guardar. */
async function subirAdjunto(file: File): Promise<{ ok: boolean; message: string }> {
  const r = await store.subirArchivo(file)
  if (r.ok) adjuntos.value.push({ id: r.data.id, nombreOriginal: r.data.nombreOriginal })
  return { ok: r.ok, message: r.ok ? '' : r.message }
}
function adjuntosListos(r: { subidos: number; errores: string[] }): void {
  if (r.errores.length) toast.error(r.errores.join(' · '))
}

async function guardar(): Promise<void> {
  if (!form.value.titulo.trim()) return
  guardando.value = true
  formError.value = ''
  const r = await store.crear({
    titulo: form.value.titulo.trim(),
    descripcion: form.value.descripcion.trim() || undefined,
    servicioId: form.value.servicioId || null,
    archivoIds: adjuntos.value.map(a => a.id),
  })
  guardando.value = false
  if (!r.ok) { formError.value = r.message; return }
  modal.value = false
  toast.success('Recibimos tu incidencia')
  await store.fetchIncidencias()
}

onMounted(async () => {
  if (!auth.usuario) await auth.cargarContexto()
  await Promise.all([store.fetchIncidencias(), store.fetchServicios()])
})
</script>

<template>
  <!-- Cada vista ruteada es su propio IonPage con su header: así el header no se superpone
       al contenido ni se come los clics de lo que esté arriba de la página. -->
  <IonPage>
    <PortalHeader />
    <IonContent class="portal-content">
    <div class="max-w-4xl mx-auto px-5 lg:px-8 py-6 ds-enter">

      <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
        <div>
          <h1 class="text-xl font-semibold tracking-tight text-ink">Incidencias</h1>
          <p class="mt-0.5 text-sm text-ink-soft">Lo que nos reportaste y en qué estado está.</p>
        </div>
        <button class="ds-btn-primary h-9" @click="abrirModal">
          <IonIcon :icon="addOutline" class="text-[16px]" /> Nueva incidencia
        </button>
      </header>

      <div v-if="store.cargando && !store.rows.length" class="space-y-2">
        <div v-for="i in 3" :key="i" class="ds-skeleton h-20"></div>
      </div>

      <div v-else-if="store.rows.length" class="space-y-5">
        <section v-for="grupo in [
          { titulo: 'Abiertas', items: pendientes, vacio: 'No tenés incidencias abiertas.' },
          { titulo: 'Resueltas', items: terminadas, vacio: '' },
        ]" :key="grupo.titulo">
          <h2 v-if="grupo.items.length" class="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">
            {{ grupo.titulo }} <span class="tnum">· {{ grupo.items.length }}</span>
          </h2>
          <div v-if="grupo.items.length" class="space-y-2">
            <article v-for="i in grupo.items" :key="i.id" class="ds-card overflow-hidden">
              <button class="w-full text-left px-4 py-3 hover:bg-surface-2/50 transition-colors" @click="abrirDetalle(i)">
                <div class="flex items-start gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="font-medium text-ink break-words">{{ i.titulo }}</p>
                    <p class="mt-0.5 text-2xs text-ink-faint">
                      {{ fmtFecha(i.createdAt) }}
                      <span v-if="i.servicio"> · {{ i.servicio.nombre }}</span>
                      <span v-else> · Consulta general</span>
                    </p>
                    <!--
                      La fecha estimada se muestra solo mientras la incidencia sigue abierta:
                      en una ya resuelta es una promesa vieja que no informa nada.
                    -->
                    <p
                      v-if="i.fechaEstimada && !ESTADOS_TERMINADOS.includes(i.estado)"
                      class="mt-1 text-2xs font-medium text-accent"
                    >
                      Fecha estimada de resolución: {{ fmtFecha(i.fechaEstimada) }}
                    </p>
                  </div>
                  <span
                    class="ds-badge shrink-0"
                    :style="{
                      color: ESTADOS_INCIDENCIA[i.estado]?.color,
                      borderColor: `${ESTADOS_INCIDENCIA[i.estado]?.color}33`,
                      background: `${ESTADOS_INCIDENCIA[i.estado]?.color}14`,
                    }"
                  >{{ ESTADOS_INCIDENCIA[i.estado]?.label ?? i.estado }}</span>
                  <IonIcon
                    :icon="chevronDownOutline" class="text-[14px] text-ink-faint shrink-0 mt-1 transition-transform"
                    :class="{ 'rotate-180': abierta === i.id }"
                  />
                </div>
              </button>

              <div v-if="abierta === i.id" class="px-4 pb-4 border-t border-line-soft pt-3">
                <p v-if="detalles[i.id]?.descripcion" class="text-sm text-ink-soft whitespace-pre-wrap break-words">
                  {{ detalles[i.id].descripcion }}
                </p>
                <p v-else class="text-sm text-ink-faint">Sin descripción.</p>

                <div v-if="detalles[i.id]?.archivos?.length" class="mt-3 flex flex-wrap gap-1.5">
                  <span
                    v-for="a in detalles[i.id].archivos" :key="a.id"
                    class="ds-badge-neutral max-w-full"
                  >
                    <IonIcon :icon="documentAttachOutline" class="text-[11px] shrink-0" />
                    <span class="truncate">{{ a.nombreOriginal }}</span>
                  </span>
                </div>

                <div v-if="detalles[i.id]?.historial?.length" class="mt-3 pt-3 border-t border-line-soft">
                  <p class="text-2xs font-medium text-ink-faint mb-1.5">Seguimiento</p>
                  <ul class="space-y-1">
                    <li v-for="h in detalles[i.id].historial" :key="h.id" class="text-2xs text-ink-soft">
                      <span class="tnum text-ink-faint">{{ fmtFecha(h.createdAt) }}</span>
                      —
                      {{ h.evento === 'creada'
                        ? 'La recibimos'
                        : `Pasó a ${(ESTADOS_INCIDENCIA[h.evento]?.label ?? h.evento).toLowerCase()}` }}
                    </li>
                  </ul>
                </div>
              </div>
            </article>
          </div>
          <template v-else-if="grupo.vacio">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{{ grupo.titulo }}</h2>
            <p class="ds-card px-6 py-8 text-center text-sm text-ink-soft">{{ grupo.vacio }}</p>
          </template>
        </section>
      </div>

      <div v-else class="ds-card px-6 py-12 text-center">
        <p class="text-sm font-medium text-ink">Todavía no cargaste ninguna incidencia.</p>
        <p class="text-xs text-ink-faint mt-1">Cuando necesites reportarnos algo, usá «Nueva incidencia».</p>
      </div>
    </div>

    <!-- Alta -->
    <Teleport to="body">
      <div v-if="modal" class="ds-modal-backdrop">
        <div class="ds-modal" role="dialog" aria-modal="true" aria-label="Nueva incidencia">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 class="text-base font-semibold text-ink">Nueva incidencia</h2>
              <p class="text-xs text-ink-soft">Contanos qué pasa y lo tomamos.</p>
            </div>
            <button class="icon-btn" aria-label="Cerrar" @click="modal = false">
              <IonIcon :icon="closeOutline" class="text-[16px]" />
            </button>
          </div>

          <form class="space-y-3" @submit.prevent="guardar">
            <div>
              <label class="ds-label" for="inc-titulo">¿Qué pasa?</label>
              <input
                id="inc-titulo" v-model="form.titulo" class="ds-input" maxlength="200"
                placeholder="Ej: no carga el checkout"
              />
            </div>

            <div>
              <label class="ds-label" for="inc-servicio">¿Sobre qué servicio?</label>
              <select id="inc-servicio" v-model.number="form.servicioId" class="ds-input">
                <!--
                  «Consulta general» siempre está: un cliente sin abonos activos ni proyectos
                  con servicio asignado tendría el selector vacío y no podría reportar nada.
                -->
                <option :value="0">Consulta general</option>
                <option v-for="s in store.servicios" :key="s.id" :value="s.id">{{ s.nombre }}</option>
              </select>
            </div>

            <div>
              <label class="ds-label" for="inc-desc">Contanos un poco más</label>
              <textarea
                id="inc-desc" v-model="form.descripcion" class="ds-input !h-auto py-2" rows="5"
                maxlength="20000" placeholder="Qué estabas haciendo, qué esperabas que pase y qué pasó."
              ></textarea>
              <p class="ds-hint">Cuanto más detalle, más rápido lo resolvemos.</p>
            </div>

            <div>
              <span class="ds-label">Adjuntos</span>
              <ZonaAdjuntos
                :subir="subirAdjunto" :deshabilitada="guardando"
                ayuda="Imágenes, PDF, Office, CSV, TXT, MD y ZIP. Hasta 5 MB las imágenes y 15 MB el resto."
                @listo="adjuntosListos"
              />
              <ul v-if="adjuntos.length" class="mt-2 space-y-1">
                <li v-for="a in adjuntos" :key="a.id" class="flex items-center gap-1.5 text-xs text-ink-soft">
                  <IonIcon :icon="documentAttachOutline" class="text-[13px] shrink-0" />
                  <span class="truncate">{{ a.nombreOriginal }}</span>
                </li>
              </ul>
            </div>

            <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>

            <footer class="flex justify-end gap-2 pt-1">
              <button type="button" class="ds-btn-secondary" @click="modal = false">Cancelar</button>
              <button type="submit" class="ds-btn-primary" :disabled="!form.titulo.trim() || guardando">
                {{ guardando ? 'Enviando…' : 'Enviar' }}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </Teleport>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.portal-content { --background: rgb(var(--s-canvas)); }
.icon-btn {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.icon-btn:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
</style>
