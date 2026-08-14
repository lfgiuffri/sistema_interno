<script setup lang="ts">
/**
 * Sitios web: disponibilidad, vencimiento de dominio y de certificado.
 *
 * El estado sale del chequeo automático cada 5 minutos, que busca el marcador
 * `<div id="app-conn-id">` del footer: por eso hay un estado intermedio («responde pero no es
 * nuestro sitio») que un ping común no distinguiría. Desde acá se puede forzar un chequeo o
 * una consulta de dominio sin esperar al próximo ciclo.
 */
import { ref, computed, onMounted } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  addOutline, createOutline, trashOutline, powerOutline, globeOutline,
  refreshOutline, openOutline, alertCircleOutline, calendarOutline, timeOutline,
} from 'ionicons/icons'
import api from '@/services/api'
import {
  useMantenimientoStore,
  type SitioWeb, type SitioInput, type SitioDetalle, type EstadoVence,
} from '@/stores/mantenimiento'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fechaHora, fecha as fmtFecha } from '@/composables/useFormato'

const store = useMantenimientoStore()
const meStore = useMeStore()
const toast = useToast()

interface Opcion { value: number; label: string }
const servicios = ref<Opcion[]>([])
const servidores = ref<Opcion[]>([])

const modalForm = ref(false)
const editando = ref<SitioWeb | null>(null)
const form = ref<SitioInput>({ nombre: '', url: '' })
const formError = ref('')
useEscapeToClose(modalForm, () => { modalForm.value = false })

const modalDetalle = ref(false)
const detalle = ref<SitioDetalle | null>(null)
useEscapeToClose(modalDetalle, () => { modalDetalle.value = false })

/** Sitio con un chequeo manual en curso (para deshabilitar el botón). */
const chequeando = ref<number | null>(null)

/** Etiqueta legible del estado de disponibilidad. */
const ETIQUETA: Record<string, string> = {
  online: 'En línea',
  sin_marcador: 'Sin marcador',
  offline: 'Caído',
  desconocido: 'Sin chequear',
}

/** Color del punto de estado. */
function colorEstado(e: string): string {
  if (e === 'online') return 'bg-ok'
  if (e === 'offline') return 'bg-danger'
  if (e === 'sin_marcador') return 'bg-warn'
  return 'bg-ink-faint'
}

/** Clase del texto de un vencimiento según cuán cerca está. */
function claseVence(v: EstadoVence): string {
  if (v.estado === 'vencido') return 'text-danger font-semibold'
  if (v.estado === 'por_vencer') return 'text-warn font-medium'
  return 'text-ink'
}

/** Texto corto de un vencimiento («12/11/26 · 90 días»). */
function textoVence(fechaISO: string | null, v: EstadoVence): string {
  if (!fechaISO) return '—'
  if (v.estado === 'vencido') return `${fmtFecha(fechaISO)} · vencido`
  return `${fmtFecha(fechaISO)} · ${v.dias} d`
}

const hayIncidentes = computed(() => store.sitios.some(s => s.incidentes.length))

async function cargarOpciones(): Promise<void> {
  const [sv, sr] = await Promise.all([
    api.get('/servicios', { params: { limit: 200 } }).catch(() => null),
    api.get('/mantenimiento/servidores').catch(() => null),
  ])
  if (sv?.data.success) servicios.value = sv.data.data.map((o: { id: number; nombre: string }) => ({ value: o.id, label: o.nombre }))
  if (sr?.data.success) servidores.value = sr.data.data.map((o: { id: number; nombre: string }) => ({ value: o.id, label: o.nombre }))
}

function abrirForm(s?: SitioWeb): void {
  editando.value = s ?? null
  form.value = s
    ? {
      nombre: s.nombre, url: s.url, servicioId: s.servicioId, servidorId: s.servidorId,
      verificaMarcador: s.verificaMarcador, dominioVenceAt: s.dominioVenceAt, observacion: s.observacion,
    }
    : { nombre: '', url: 'https://', verificaMarcador: true }
  formError.value = ''
  modalForm.value = true
}

async function guardar(): Promise<void> {
  formError.value = ''
  const r = await store.saveSitio({ ...form.value }, editando.value?.id)
  if (!r.ok) { formError.value = r.message; return }
  modalForm.value = false
  toast.success(editando.value ? 'Sitio actualizado' : 'Sitio creado')
  await store.fetchSitios()
}

async function chequear(s: SitioWeb): Promise<void> {
  chequeando.value = s.id
  try {
    const r = await store.chequearSitio(s.id)
    if (!r) { toast.error('No se pudo chequear el sitio'); return }
    if (r.estado === 'online') toast.success(`${s.nombre} responde bien (${r.tiempoMs} ms)`)
    else toast.error(r.motivo ?? 'El sitio no responde')
    await store.fetchSitios()
  } finally {
    chequeando.value = null
  }
}

async function consultarDominio(s: SitioWeb): Promise<void> {
  const r = await store.consultarDominio(s.id)
  if (!r) { toast.error('No se pudo consultar el dominio'); return }
  if (r.ok && r.venceAt) toast.success(`${r.dominio} vence el ${fmtFecha(r.venceAt)}`)
  else toast.error(r.motivo ?? 'No se pudo obtener la fecha')
  await store.fetchSitios()
}

async function verDetalle(s: SitioWeb): Promise<void> {
  detalle.value = await store.fetchSitio(s.id)
  if (detalle.value) modalDetalle.value = true
}

async function toggle(s: SitioWeb): Promise<void> {
  const r = await store.toggleSitio(s.id)
  if (!r.ok) { toast.error(r.message); return }
  await store.fetchSitios()
}

async function eliminar(s: SitioWeb): Promise<void> {
  if (!confirm(`¿Eliminar el sitio «${s.nombre}»? Se borra también su historial de chequeos.`)) return
  const r = await store.removeSitio(s.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Sitio eliminado')
  await store.fetchSitios()
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void store.fetchSitios(); void cargarOpciones() })
onIonViewWillEnter(() => { if (loadedOnce) void store.fetchSitios() })
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
            <h1 class="text-xl font-semibold tracking-tight text-ink">Sitios web</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              Se chequean cada 5 minutos. Los dominios se consultan una vez por día.
            </p>
          </div>
          <button v-if="meStore.can('sitios:create')" class="ds-btn-primary flex items-center gap-1.5" @click="abrirForm()">
            <IonIcon :icon="addOutline" class="text-[16px]" /> Nuevo sitio
          </button>
        </header>

        <div v-if="store.loadingSitios && !store.sitios.length" class="space-y-2">
          <div v-for="i in 3" :key="i" class="ds-skeleton h-16"></div>
        </div>

        <div v-else-if="store.sitios.length" class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th>Sitio</th>
                <th class="w-32">Estado</th>
                <th class="w-36">Dominio</th>
                <th class="w-36">Certificado</th>
                <th class="w-32">Último chequeo</th>
                <th class="w-32"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in store.sitios" :key="s.id" :class="{ 'opacity-50': !s.activo }">
                <td>
                  <button class="text-left group" @click="verDetalle(s)">
                    <div class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full shrink-0" :class="colorEstado(s.estado)" :title="ETIQUETA[s.estado]"></span>
                      <span class="font-medium text-ink group-hover:text-accent transition-colors">{{ s.nombre }}</span>
                      <span v-if="s.servicio" class="ds-badge-neutral">{{ s.servicio.nombre }}</span>
                      <span v-if="s.incidentes.length" class="ds-badge-danger">
                        <IonIcon :icon="alertCircleOutline" class="text-[11px]" />
                        {{ s.incidentes.length }}
                      </span>
                    </div>
                    <p class="text-2xs text-ink-faint font-mono truncate max-w-[320px]">
                      {{ s.url }}<span v-if="s.servidor"> · {{ s.servidor.nombre }}</span>
                    </p>
                  </button>
                </td>
                <td>
                  <span class="text-xs" :class="s.estado === 'online' ? 'text-ink' : s.estado === 'desconocido' ? 'text-ink-faint' : 'text-danger font-medium'">
                    {{ ETIQUETA[s.estado] }}
                  </span>
                  <p v-if="s.tiempoMs && s.estado !== 'desconocido'" class="text-2xs text-ink-faint tnum">{{ s.tiempoMs }} ms</p>
                </td>
                <td class="text-xs tnum" :class="claseVence(s.dominioEstado)">
                  {{ textoVence(s.dominioVenceAt, s.dominioEstado) }}
                  <p v-if="!s.dominioVenceAt" class="text-2xs text-ink-faint">sin fecha</p>
                </td>
                <td class="text-xs tnum" :class="claseVence(s.tlsEstado)">
                  {{ textoVence(s.tlsVenceAt, s.tlsEstado) }}
                </td>
                <td class="text-2xs text-ink-faint tnum">
                  {{ s.ultimoChequeoAt ? fechaHora(s.ultimoChequeoAt) : 'nunca' }}
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <a class="row-action" :href="s.url" target="_blank" rel="noopener" title="Abrir el sitio" aria-label="Abrir el sitio">
                      <IonIcon :icon="openOutline" class="text-[15px]" />
                    </a>
                    <button
                      v-if="meStore.can('sitios:update')" class="row-action" :disabled="chequeando === s.id"
                      title="Chequear ahora" aria-label="Chequear ahora" @click="chequear(s)"
                    >
                      <IonIcon :icon="refreshOutline" class="text-[15px]" :class="{ 'animate-spin': chequeando === s.id }" />
                    </button>
                    <button v-if="meStore.can('sitios:update')" class="row-action" title="Consultar el vencimiento del dominio" aria-label="Consultar dominio" @click="consultarDominio(s)">
                      <IonIcon :icon="calendarOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('sitios:update')" class="row-action" title="Editar" aria-label="Editar" @click="abrirForm(s)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('sitios:toggle')" class="row-action" :title="s.activo ? 'Desactivar' : 'Activar'" aria-label="Activar o desactivar" @click="toggle(s)">
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('sitios:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="eliminar(s)">
                      <IonIcon :icon="trashOutline" class="text-[15px]" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="ds-card flex flex-col items-center py-14 text-center">
          <div class="w-10 h-10 rounded-lg bg-surface-2 grid place-items-center mb-3">
            <IonIcon :icon="globeOutline" class="text-[18px] text-ink-faint" />
          </div>
          <p class="text-sm font-medium text-ink">Todavía no hay sitios cargados</p>
          <p class="text-xs text-ink-faint mt-1">Cargá una URL y el sistema la chequea solo cada 5 minutos.</p>
          <button v-if="meStore.can('sitios:create')" class="ds-btn-primary mt-4" @click="abrirForm()">Agregar el primero</button>
        </div>

        <p v-if="hayIncidentes" class="text-2xs text-ink-faint mt-2">
          Los sitios con alerta tienen un incidente abierto: se avisa una vez al detectarlo y otra al resolverse.
        </p>
      </div>

      <!-- Alta / edición -->
      <Teleport defer to="ion-app">
        <div v-if="modalForm" class="ds-modal-backdrop" @click.self="modalForm = false">
          <div class="ds-modal max-w-md" role="dialog" aria-modal="true" :aria-label="editando ? 'Editar sitio' : 'Nuevo sitio'">
            <h2 class="text-base font-semibold text-ink mb-3">{{ editando ? 'Editar sitio' : 'Nuevo sitio' }}</h2>
            <form class="space-y-3" @submit.prevent="guardar">
              <div>
                <label class="ds-label" for="st-nombre">Nombre</label>
                <input id="st-nombre" v-model="form.nombre" class="ds-input" required maxlength="150" />
              </div>
              <div>
                <label class="ds-label" for="st-url">URL</label>
                <input id="st-url" v-model="form.url" class="ds-input font-mono" required maxlength="255" placeholder="https://ejemplo.com.ar" />
                <p class="ds-hint">Tiene que incluir http:// o https://.</p>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="ds-label" for="st-servicio">Servicio</label>
                  <select id="st-servicio" v-model="form.servicioId" class="ds-input">
                    <option :value="null">—</option>
                    <option v-for="o in servicios" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </div>
                <div>
                  <label class="ds-label" for="st-servidor">Servidor</label>
                  <select id="st-servidor" v-model="form.servidorId" class="ds-input">
                    <option :value="null">—</option>
                    <option v-for="o in servidores" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </div>
              </div>

              <label class="flex items-start gap-2 text-sm text-ink cursor-pointer">
                <input v-model="form.verificaMarcador" type="checkbox" class="accent-[#0F7660] mt-0.5" />
                <span>
                  Es un sitio nuestro
                  <span class="block text-2xs text-ink-faint">
                    Con esto marcado se verifica que la página traiga el marcador
                    <span class="font-mono">#app-conn-id</span> del footer, no solo que el servidor
                    responda. Destildalo para un sitio de un tercero.
                  </span>
                </span>
              </label>

              <div>
                <label class="ds-label" for="st-vence">Vencimiento del dominio</label>
                <input id="st-vence" v-model="form.dominioVenceAt" class="ds-input" type="date" />
                <p class="ds-hint">
                  Se completa solo con la consulta diaria. Cargala a mano si el registro del dominio
                  no publica la fecha (.io, .uy, .cl…): con una fecha manual el sistema deja de pisarla.
                </p>
              </div>

              <div>
                <label class="ds-label" for="st-obs">Observación</label>
                <input id="st-obs" v-model="form.observacion" class="ds-input" />
              </div>

              <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalForm = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!form.nombre.trim() || !form.url.trim()">
                  {{ editando ? 'Guardar' : 'Crear sitio' }}
                </button>
              </footer>
            </form>
          </div>
        </div>
      </Teleport>

      <!-- Detalle: historial de chequeos e incidentes -->
      <Teleport defer to="ion-app">
        <div v-if="modalDetalle && detalle" class="ds-modal-backdrop" @click.self="modalDetalle = false">
          <div class="ds-modal ds-modal-lg" role="dialog" aria-modal="true" aria-label="Detalle del sitio">
            <header class="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 class="text-base font-semibold text-ink">{{ detalle.nombre }}</h2>
                <p class="text-2xs text-ink-faint font-mono">{{ detalle.url }}</p>
              </div>
              <div class="text-right shrink-0">
                <p class="text-2xl font-semibold text-ink tnum">
                  {{ detalle.disponibilidad !== null ? `${detalle.disponibilidad}%` : '—' }}
                </p>
                <p class="text-2xs text-ink-faint">disponibilidad medida</p>
              </div>
            </header>

            <div class="grid grid-cols-3 gap-2 mb-4">
              <div class="border border-line rounded-lg p-2.5">
                <p class="text-2xs text-ink-faint">Estado</p>
                <p class="text-sm font-medium" :class="detalle.estado === 'online' ? 'text-ink' : 'text-danger'">
                  {{ ETIQUETA[detalle.estado] }}
                </p>
              </div>
              <div class="border border-line rounded-lg p-2.5">
                <p class="text-2xs text-ink-faint">Dominio {{ detalle.dominio ? `(${detalle.dominio})` : '' }}</p>
                <p class="text-sm tnum" :class="claseVence(detalle.dominioEstado)">
                  {{ textoVence(detalle.dominioVenceAt, detalle.dominioEstado) }}
                </p>
              </div>
              <div class="border border-line rounded-lg p-2.5">
                <p class="text-2xs text-ink-faint">Certificado</p>
                <p class="text-sm tnum" :class="claseVence(detalle.tlsEstado)">
                  {{ textoVence(detalle.tlsVenceAt, detalle.tlsEstado) }}
                </p>
              </div>
            </div>

            <div v-if="detalle.incidentes.length" class="mb-4">
              <h3 class="text-xs font-semibold text-ink mb-1.5">Incidentes</h3>
              <ul class="space-y-1">
                <li v-for="i in detalle.incidentes" :key="i.id" class="flex items-start gap-2 text-2xs">
                  <span class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" :class="i.resueltoAt ? 'bg-ok' : 'bg-danger'"></span>
                  <span class="text-ink-soft">
                    <span class="font-medium text-ink">{{ i.tipo }}</span> ·
                    {{ fechaHora(i.createdAt) }}{{ i.resueltoAt ? ` → resuelto ${fechaHora(i.resueltoAt)}` : ' · abierto' }}
                    <span v-if="i.detalle" class="block text-ink-faint">{{ i.detalle }}</span>
                  </span>
                </li>
              </ul>
            </div>

            <h3 class="text-xs font-semibold text-ink mb-1.5 flex items-center gap-1.5">
              <IonIcon :icon="timeOutline" class="text-[13px]" /> Últimos chequeos
            </h3>
            <div class="max-h-64 overflow-y-auto border border-line rounded-lg">
              <table class="ds-table">
                <tbody>
                  <tr v-for="c in detalle.chequeos" :key="c.id">
                    <td class="w-2">
                      <span class="w-1.5 h-1.5 rounded-full block" :class="colorEstado(c.estado)"></span>
                    </td>
                    <td class="text-2xs text-ink-faint tnum w-32">{{ fechaHora(c.createdAt) }}</td>
                    <td class="text-2xs tnum w-16">{{ c.httpStatus ?? '—' }}</td>
                    <td class="text-2xs tnum w-20">{{ c.tiempoMs ? `${c.tiempoMs} ms` : '—' }}</td>
                    <td class="text-2xs text-ink-soft">{{ c.motivo ?? 'OK' }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!detalle.chequeos.length" class="text-2xs text-ink-faint p-3 text-center">
                Todavía no hay chequeos: el primero sale en el próximo ciclo de 5 minutos.
              </p>
            </div>

            <footer class="flex justify-end pt-4">
              <button type="button" class="ds-btn-primary" @click="modalDetalle = false">Cerrar</button>
            </footer>
          </div>
        </div>
      </Teleport>
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
.row-action:disabled { opacity: 0.5; cursor: default; }
</style>
