<script setup lang="ts">
/**
 * Servidores: inventario de VPS con su estado y sus métricas actuales.
 *
 * Los que administramos (`monitorea`) reportan por agente y su estado sale del heartbeat;
 * los de terceros se chequean por TCP desde el servidor de la app. Al dar de alta uno nuevo
 * se muestra el token del agente UNA sola vez, con el comando de instalación listo.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  addOutline, createOutline, trashOutline, powerOutline, serverOutline,
  copyOutline, keyOutline, alertCircleOutline,
} from 'ionicons/icons'
import { useMantenimientoStore, type Servidor, type ServidorInput } from '@/stores/mantenimiento'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'
import { fechaHora } from '@/composables/useFormato'

const store = useMantenimientoStore()
const meStore = useMeStore()
const toast = useToast()
const router = useRouter()

const modalForm = ref(false)
const editando = ref<Servidor | null>(null)
const form = ref<ServidorInput>({ nombre: '', ip: '', monitorea: true, puertoChequeo: 443 })
const formError = ref('')
useEscapeToClose(modalForm, () => { modalForm.value = false })

// Token del agente: se ve UNA sola vez (el backend guarda solo el hash).
const modalToken = ref(false)
const token = ref('')
const servidorToken = ref<Servidor | null>(null)
useEscapeToClose(modalToken, () => { modalToken.value = false })

const apiUrl = computed(() => `${window.location.origin}/api`)
const comandoInstalacion = computed(() =>
  `curl -fsSL ${apiUrl.value}/agente/instalar-agente.sh | sudo API_URL=${apiUrl.value} AGENT_TOKEN=${token.value} bash`,
)

/** Color del punto de estado. */
const colorEstado = (s: Servidor): string =>
  (s.estado === 'online' ? 'bg-ok' : s.estado === 'offline' ? 'bg-danger' : 'bg-ink-faint')

/** Clase del valor de una métrica según su umbral (rojo si lo supera). */
function claseMetrica(valor: number | undefined, umbral: number | null, global = 85): string {
  if (valor === undefined) return 'text-ink-faint'
  return valor >= (umbral ?? global) ? 'text-danger font-semibold' : 'text-ink'
}

function abrirForm(s?: Servidor): void {
  editando.value = s ?? null
  form.value = s
    ? {
      nombre: s.nombre, ip: s.ip, monitorea: s.monitorea, puertoChequeo: s.puertoChequeo,
      umbralCpu: s.umbralCpu, umbralRam: s.umbralRam, umbralDisco: s.umbralDisco,
      observaciones: s.observaciones,
    }
    : { nombre: '', ip: '', monitorea: true, puertoChequeo: 443 }
  formError.value = ''
  modalForm.value = true
}

async function guardar(): Promise<void> {
  formError.value = ''
  const r = await store.save({ ...form.value }, editando.value?.id)
  if (!r.ok) { formError.value = r.message; return }

  modalForm.value = false
  await store.fetchServidores()

  // Alta con agente: se muestra el token una única vez.
  if (!editando.value && r.token) {
    token.value = r.token
    servidorToken.value = store.servidores.find(s => s.ip === form.value.ip) ?? null
    modalToken.value = true
  } else {
    toast.success(editando.value ? 'Servidor actualizado' : 'Servidor creado')
  }
}

async function regenerar(s: Servidor): Promise<void> {
  if (!confirm(`¿Regenerar el token de «${s.nombre}»?\n\nEl agente instalado va a dejar de reportar hasta que lo reinstales con el token nuevo.`)) return
  const r = await store.regenerarToken(s.id)
  if (!r.ok || !r.token) { toast.error(r.message); return }
  token.value = r.token
  servidorToken.value = s
  modalToken.value = true
}

async function toggle(s: Servidor): Promise<void> {
  const r = await store.toggle(s.id)
  if (!r.ok) { toast.error(r.message); return }
  await store.fetchServidores()
}

async function eliminar(s: Servidor): Promise<void> {
  if (!confirm(`¿Eliminar el servidor «${s.nombre}»? Se borra también su historial de métricas.`)) return
  const r = await store.remove(s.id)
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Servidor eliminado')
  await store.fetchServidores()
}

async function copiar(texto: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto)
    toast.success('Copiado')
  } catch {
    toast.error('No se pudo copiar: seleccionalo a mano')
  }
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void store.fetchServidores() })
onIonViewWillEnter(() => { if (loadedOnce) void store.fetchServidores() })
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
            <h1 class="text-xl font-semibold tracking-tight text-ink">Servidores</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              Estado y consumo de los VPS.
            </p>
          </div>
          <button v-if="meStore.can('servidores:create')" class="ds-btn-primary flex items-center gap-1.5" @click="abrirForm()">
            <IonIcon :icon="addOutline" class="text-[16px]" /> Nuevo servidor
          </button>
        </header>

        <div v-if="store.loading && !store.servidores.length" class="space-y-2">
          <div v-for="i in 3" :key="i" class="ds-skeleton h-16"></div>
        </div>

        <div v-else-if="store.servidores.length" class="ds-card overflow-x-auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th>Servidor</th>
                <th class="w-20">CPU</th>
                <th class="w-20">RAM</th>
                <th class="w-20">Disco</th>
                <th>Último contacto</th>
                <th class="w-28"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in store.servidores" :key="s.id" :class="{ 'opacity-50': !s.activo }">
                <td>
                  <button class="text-left group" @click="router.push(`/mantenimiento/servidores/${s.id}`)">
                    <div class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full shrink-0" :class="colorEstado(s)" :title="s.estado"></span>
                      <span class="font-medium text-ink group-hover:text-accent transition-colors">{{ s.nombre }}</span>
                      <span v-if="!s.monitorea" class="ds-badge-neutral">solo disponibilidad</span>
                      <span v-if="s.incidentes.length" class="ds-badge-danger">
                        <IonIcon :icon="alertCircleOutline" class="text-[11px]" />
                        {{ s.incidentes.join(', ') }}
                      </span>
                    </div>
                    <p class="text-2xs text-ink-faint font-mono">{{ s.ip }}<span v-if="s.so"> · {{ s.so }}</span></p>
                  </button>
                </td>
                <td class="tnum" :class="claseMetrica(s.ultima?.cpu, s.umbralCpu, 90)">
                  {{ s.ultima ? `${s.ultima.cpu}%` : '—' }}
                </td>
                <td class="tnum" :class="claseMetrica(s.ultima?.ram, s.umbralRam, 90)">
                  {{ s.ultima ? `${s.ultima.ram}%` : '—' }}
                </td>
                <td class="tnum" :class="claseMetrica(s.ultima?.disco, s.umbralDisco, 85)">
                  {{ s.ultima ? `${s.ultima.disco}%` : '—' }}
                </td>
                <td class="text-2xs text-ink-faint tnum">
                  {{ s.ultimoContactoAt ? fechaHora(s.ultimoContactoAt) : 'sin datos todavía' }}
                </td>
                <td>
                  <div class="flex items-center justify-end gap-0.5">
                    <button
                      v-if="s.monitorea && meStore.can('servidores:update')"
                      class="row-action" title="Token del agente" aria-label="Token del agente"
                      @click="regenerar(s)"
                    >
                      <IonIcon :icon="keyOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('servidores:update')" class="row-action" title="Editar" aria-label="Editar" @click="abrirForm(s)">
                      <IonIcon :icon="createOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('servidores:toggle')" class="row-action" :title="s.activo ? 'Desactivar' : 'Activar'" aria-label="Activar o desactivar" @click="toggle(s)">
                      <IonIcon :icon="powerOutline" class="text-[15px]" />
                    </button>
                    <button v-if="meStore.can('servidores:delete')" class="row-action hover:!text-danger" title="Eliminar" aria-label="Eliminar" @click="eliminar(s)">
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
            <IonIcon :icon="serverOutline" class="text-[18px] text-ink-faint" />
          </div>
          <p class="text-sm font-medium text-ink">Todavía no hay servidores cargados</p>
          <p class="text-xs text-ink-faint mt-1">Al dar de alta uno te doy el comando para instalar el agente.</p>
          <button v-if="meStore.can('servidores:create')" class="ds-btn-primary mt-4" @click="abrirForm()">Agregar el primero</button>
        </div>

        <p class="text-2xs text-ink-faint mt-2">
          Los umbrales que disparan alerta se configuran en <button class="underline" @click="router.push('/configuracion?s=negocio')">Configuración</button>,
          y cada servidor puede tener el suyo propio.
        </p>
      </div>

      <!-- Alta / edición -->
      <Teleport defer to="ion-app">
        <div v-if="modalForm" class="ds-modal-backdrop" @click.self="modalForm = false">
          <div class="ds-modal max-w-md" role="dialog" aria-modal="true" :aria-label="editando ? 'Editar servidor' : 'Nuevo servidor'">
            <h2 class="text-base font-semibold text-ink mb-3">{{ editando ? 'Editar servidor' : 'Nuevo servidor' }}</h2>
            <form class="space-y-3" @submit.prevent="guardar">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="ds-label" for="sv-nombre">Nombre</label>
                  <input id="sv-nombre" v-model="form.nombre" class="ds-input" required maxlength="120" />
                </div>
                <div>
                  <label class="ds-label" for="sv-ip">IP o host</label>
                  <input id="sv-ip" v-model="form.ip" class="ds-input font-mono" required maxlength="45" />
                </div>
              </div>

              <label class="flex items-start gap-2 text-sm text-ink cursor-pointer">
                <input v-model="form.monitorea" type="checkbox" class="accent-[#0F7660] mt-0.5" />
                <span>
                  Lo administramos nosotros
                  <span class="block text-2xs text-ink-faint">
                    Con esto marcado se instala el agente y se miden CPU, RAM y disco. Sin marcar, solo se
                    chequea que responda.
                  </span>
                </span>
              </label>

              <div v-if="!form.monitorea">
                <label class="ds-label" for="sv-puerto">Puerto a chequear</label>
                <input id="sv-puerto" v-model.number="form.puertoChequeo" class="ds-input w-32 font-mono" type="number" min="1" max="65535" />
                <p class="ds-hint">443 para un servidor web, 22 si solo tiene SSH.</p>
              </div>

              <div v-if="form.monitorea">
                <span class="ds-label">Umbrales propios (opcional)</span>
                <div class="grid grid-cols-3 gap-2">
                  <input v-model.number="form.umbralCpu" class="ds-input" type="number" min="50" max="100" placeholder="CPU" />
                  <input v-model.number="form.umbralRam" class="ds-input" type="number" min="50" max="100" placeholder="RAM" />
                  <input v-model.number="form.umbralDisco" class="ds-input" type="number" min="50" max="100" placeholder="Disco" />
                </div>
                <p class="ds-hint">Vacío = usa el umbral general. Completalo solo si este servidor vive alto a propósito.</p>
              </div>

              <div>
                <label class="ds-label" for="sv-obs">Observaciones</label>
                <input id="sv-obs" v-model="form.observaciones" class="ds-input" />
              </div>

              <p v-if="formError" class="ds-error" role="alert">{{ formError }}</p>
              <footer class="flex justify-end gap-2 pt-1">
                <button type="button" class="ds-btn-secondary" @click="modalForm = false">Cancelar</button>
                <button type="submit" class="ds-btn-primary" :disabled="!form.nombre.trim() || !form.ip.trim()">
                  {{ editando ? 'Guardar' : 'Crear servidor' }}
                </button>
              </footer>
            </form>
          </div>
        </div>
      </Teleport>

      <!-- Token del agente (se muestra una sola vez) -->
      <Teleport defer to="ion-app">
        <div v-if="modalToken" class="ds-modal-backdrop" @click.self="modalToken = false">
          <div class="ds-modal ds-modal-lg" role="dialog" aria-modal="true" aria-label="Instalar el agente">
            <h2 class="text-base font-semibold text-ink mb-1">Instalar el agente en {{ servidorToken?.nombre ?? 'el servidor' }}</h2>
            <p class="text-xs text-ink-soft mb-3">
              Copiá este comando y pegalo en el servidor. <strong>El token se muestra una sola vez</strong>:
              si lo perdés, generá uno nuevo desde la llave del listado.
            </p>

            <div class="border border-line rounded-lg bg-surface-2 p-3 font-mono text-2xs text-ink break-all">
              {{ comandoInstalacion }}
            </div>
            <button class="ds-btn-secondary mt-2 flex items-center gap-1.5" @click="copiar(comandoInstalacion)">
              <IonIcon :icon="copyOutline" class="text-[15px]" /> Copiar comando
            </button>

            <ul class="text-2xs text-ink-faint mt-3 space-y-1">
              <li>· Instala un timer de systemd que reporta cada minuto.</li>
              <li>· No abre ningún puerto en el servidor: solo hace una llamada saliente.</li>
              <li>· Para verificar: <span class="font-mono">journalctl -u sistema-interno-agente -n 20</span></li>
            </ul>

            <footer class="flex justify-end pt-4">
              <button type="button" class="ds-btn-primary" @click="modalToken = false">Listo</button>
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
</style>
