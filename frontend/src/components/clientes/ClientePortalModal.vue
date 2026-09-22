<script setup lang="ts">
/**
 * Configuración de PORTAL y AVISOS de un cliente: a quién se le avisa, de qué se le avisa, y
 * quiénes entran al portal.
 *
 * Vive en un modal propio y no en el form genérico de `CatalogoPage` por dos motivos: ese form
 * solo sabe de campos escalares (y acá hay una lista de mails, cinco checkboxes y un sub-ABM),
 * y meterlo ahí obligaría a tocar el componente que comparten los otros tres catálogos.
 */
import { ref, watch, computed } from 'vue'
import { IonIcon, alertController } from '@ionic/vue'
import { closeOutline, addOutline, trashOutline, keyOutline, powerOutline } from 'ionicons/icons'
import api, { apiErrorMessage } from '@/services/api'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'

const props = defineProps<{ open: boolean; cliente: { id: number; nombre: string } | null }>()
const emit = defineEmits<{ (e: 'cerrar'): void; (e: 'guardado'): void }>()

const meStore = useMeStore()
const toast = useToast()

/**
 * Los eventos que se pueden avisar. Espeja `AVISOS_INCIDENCIA` del backend, que es la fuente
 * única: si allá se agrega uno, se agrega acá.
 */
const AVISOS = [
  { campo: 'avisaCreada', label: 'Cuando se carga la incidencia', ayuda: 'Le confirma que la recibimos.' },
  { campo: 'avisaNueva', label: 'Cuando vuelve a «nueva»', ayuda: 'Pasa si se reabre.' },
  { campo: 'avisaEnProgreso', label: 'Cuando pasa a «en progreso»', ayuda: 'Movimiento interno; suele ser ruido.' },
  { campo: 'avisaResuelta', label: 'Cuando queda resuelta', ayuda: '' },
]

const emails = ref('')
const avisos = ref<Record<string, boolean>>({})
const guardando = ref(false)
const error = ref('')

const usuarios = ref<Array<{ id: number; nombre: string; email: string; activo: boolean }>>([])
const nuevoUsuario = ref({ nombre: '', email: '', password: '' })
const creandoUsuario = ref(false)
const usuarioError = ref('')

const puedeUsuarios = computed(() => meStore.can('clientes:usuarios'))
/** Cuántos mails hay cargados (se separan por coma, punto y coma o salto de línea). */
const cantidadMails = computed(() =>
  emails.value.split(/[,;\n]/).map(m => m.trim()).filter(Boolean).length,
)
const todosApagados = computed(() => AVISOS.every(a => avisos.value[a.campo] === false))

// `useEscapeToClose` espera un Ref; el prop se envuelve en un computed.
const abiertoRef = computed(() => props.open)
useEscapeToClose(abiertoRef, () => emit('cerrar'))

watch(() => props.open, async (abierto) => {
  if (!abierto || !props.cliente) return
  error.value = ''
  usuarioError.value = ''
  nuevoUsuario.value = { nombre: '', email: '', password: '' }
  try {
    const { data } = await api.get(`/clientes/${props.cliente.id}`)
    if (data.success) {
      emails.value = data.data.emailsNotificacion ?? ''
      avisos.value = Object.fromEntries(AVISOS.map(a => [a.campo, data.data[a.campo] !== false]))
    }
  } catch (e) { error.value = apiErrorMessage(e) }
  if (puedeUsuarios.value) await cargarUsuarios()
})

async function cargarUsuarios(): Promise<void> {
  if (!props.cliente) return
  try {
    const { data } = await api.get(`/clientes/${props.cliente.id}/usuarios`)
    if (data.success) usuarios.value = data.data
  } catch { usuarios.value = [] }
}

async function guardar(): Promise<void> {
  if (!props.cliente) return
  guardando.value = true
  error.value = ''
  try {
    // El PUT del cliente exige el nombre; el resto viaja tal cual.
    const { data } = await api.put(`/clientes/${props.cliente.id}`, {
      nombre: props.cliente.nombre,
      emailsNotificacion: emails.value,
      ...avisos.value,
    })
    if (!data.success) { error.value = data.message; return }
    toast.success('Configuración guardada')
    emit('guardado')
    emit('cerrar')
  } catch (e) {
    error.value = apiErrorMessage(e)
  } finally {
    guardando.value = false
  }
}

async function crearUsuario(): Promise<void> {
  if (!props.cliente) return
  creandoUsuario.value = true
  usuarioError.value = ''
  try {
    const { data } = await api.post(`/clientes/${props.cliente.id}/usuarios`, nuevoUsuario.value)
    if (!data.success) { usuarioError.value = data.message; return }
    nuevoUsuario.value = { nombre: '', email: '', password: '' }
    toast.success('Acceso creado')
    await cargarUsuarios()
  } catch (e) {
    usuarioError.value = apiErrorMessage(e)
  } finally {
    creandoUsuario.value = false
  }
}

async function toggleUsuario(u: { id: number }): Promise<void> {
  if (!props.cliente) return
  await api.patch(`/clientes/${props.cliente.id}/usuarios/${u.id}/active`).catch(() => null)
  await cargarUsuarios()
}

/** Resetear la contraseña es mandarla de nuevo: no hay flujo por mail, a propósito. */
async function resetearPassword(u: { id: number; nombre: string }): Promise<void> {
  const alert = await alertController.create({
    backdropDismiss: false,
    header: 'Nueva contraseña',
    message: `Elegí la contraseña de ${u.nombre} y pasásela vos. No se manda ningún mail.`,
    inputs: [{ name: 'password', type: 'password', placeholder: 'Al menos 8 caracteres' }],
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Guardar',
        handler: async (v: { password: string }) => {
          if (!v.password || v.password.length < 8) { toast.error('Al menos 8 caracteres'); return false }
          const { data } = await api.put(`/clientes/${props.cliente!.id}/usuarios/${u.id}`, { password: v.password })
          if (data.success) toast.success('Contraseña actualizada')
          else toast.error(data.message)
          return true
        },
      },
    ],
  })
  await alert.present()
}

async function eliminarUsuario(u: { id: number; nombre: string }): Promise<void> {
  const alert = await alertController.create({
    backdropDismiss: false,
    header: 'Quitar acceso',
    message: `${u.nombre} deja de poder entrar al portal.`,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Quitar', role: 'destructive',
        handler: async () => {
          await api.delete(`/clientes/${props.cliente!.id}/usuarios/${u.id}`).catch(() => null)
          await cargarUsuarios()
          toast.success('Acceso quitado')
        },
      },
    ],
  })
  await alert.present()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && cliente" class="ds-modal-backdrop">
      <div class="ds-modal ds-modal-lg" role="dialog" aria-modal="true" aria-label="Portal y avisos">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 class="text-base font-semibold text-ink">Portal y avisos</h2>
            <p class="text-xs text-ink-soft">{{ cliente.nombre }}</p>
          </div>
          <button class="row-action" aria-label="Cerrar" @click="emit('cerrar')">
            <IonIcon :icon="closeOutline" class="text-[16px]" />
          </button>
        </div>

        <div class="grid lg:grid-cols-2 gap-5">
          <section class="space-y-3">
            <div>
              <label class="ds-label" for="cp-mails">Mails para avisos</label>
              <textarea
                id="cp-mails" v-model="emails" class="ds-input !h-auto py-2" rows="3"
                placeholder="jefe@cliente.com, contable@cliente.com"
              ></textarea>
              <p class="ds-hint">
                Separados por coma. Pueden ser distintos de los usuarios del portal: acá va quien
                necesita enterarse, entre o no al portal.
              </p>
            </div>

            <div>
              <span class="ds-label">De qué se le avisa</span>
              <div class="rounded-md border border-line bg-surface-3 divide-y divide-line-soft">
                <label
                  v-for="a in AVISOS" :key="a.campo"
                  class="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-surface-2"
                >
                  <input v-model="avisos[a.campo]" type="checkbox" class="accent-[#0F7660] mt-0.5 shrink-0" />
                  <span class="min-w-0">
                    <span class="text-sm text-ink">{{ a.label }}</span>
                    <span v-if="a.ayuda" class="block text-2xs text-ink-faint">{{ a.ayuda }}</span>
                  </span>
                </label>
              </div>
              <p v-if="todosApagados" class="ds-hint text-warn">
                Con todo destildado, este cliente no recibe ningún mail.
              </p>
              <p v-else-if="!cantidadMails" class="ds-hint text-warn">
                No hay ningún mail cargado: los avisos no tienen a quién ir.
              </p>
            </div>

            <p v-if="error" class="ds-error" role="alert">{{ error }}</p>
            <button class="ds-btn-primary h-9" :disabled="guardando" @click="guardar">
              {{ guardando ? 'Guardando…' : 'Guardar avisos' }}
            </button>
          </section>

          <section v-if="puedeUsuarios">
            <span class="ds-label">Accesos al portal</span>
            <div v-if="usuarios.length" class="rounded-md border border-line divide-y divide-line-soft mb-3">
              <div
                v-for="u in usuarios" :key="u.id"
                class="flex items-center gap-2 px-3 py-2" :class="{ 'opacity-55': !u.activo }"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-sm text-ink truncate">{{ u.nombre }}</p>
                  <p class="text-2xs text-ink-faint truncate">
                    {{ u.email }}<span v-if="!u.activo"> · sin acceso</span>
                  </p>
                </div>
                <button class="row-action" title="Cambiar la contraseña" aria-label="Cambiar la contraseña" @click="resetearPassword(u)">
                  <IonIcon :icon="keyOutline" class="text-[15px]" />
                </button>
                <button class="row-action" :title="u.activo ? 'Desactivar' : 'Activar'" :aria-label="u.activo ? 'Desactivar' : 'Activar'" @click="toggleUsuario(u)">
                  <IonIcon :icon="powerOutline" class="text-[15px]" />
                </button>
                <button class="row-action hover:!text-danger" title="Quitar" aria-label="Quitar" @click="eliminarUsuario(u)">
                  <IonIcon :icon="trashOutline" class="text-[15px]" />
                </button>
              </div>
            </div>
            <p v-else class="text-xs text-ink-faint mb-3 py-3">Este cliente todavía no tiene accesos al portal.</p>

            <form class="space-y-2 rounded-md border border-line-soft p-3" @submit.prevent="crearUsuario">
              <p class="text-xs font-medium text-ink">Dar acceso a alguien</p>
              <input v-model="nuevoUsuario.nombre" class="ds-input h-8" placeholder="Nombre y apellido" />
              <input v-model="nuevoUsuario.email" class="ds-input h-8" type="email" placeholder="Email (con esto entra)" />
              <input v-model="nuevoUsuario.password" class="ds-input h-8" type="password" placeholder="Contraseña (mín. 8)" />
              <p class="ds-hint">La contraseña se la pasás vos: no se manda ningún mail.</p>
              <p v-if="usuarioError" class="ds-error" role="alert">{{ usuarioError }}</p>
              <button
                type="submit" class="ds-btn-secondary h-8 text-xs"
                :disabled="!nuevoUsuario.nombre || !nuevoUsuario.email || nuevoUsuario.password.length < 8 || creandoUsuario"
              >
                <IonIcon :icon="addOutline" class="text-[14px]" /> {{ creandoUsuario ? 'Creando…' : 'Crear acceso' }}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.row-action {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
</style>
