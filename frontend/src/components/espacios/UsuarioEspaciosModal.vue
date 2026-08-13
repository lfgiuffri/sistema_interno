<script setup lang="ts">
/**
 * Matriz de espacios del EJE USUARIO (se abre desde Usuarios). Reemplaza SOLO las filas
 * de este usuario; un admin no se edita (entra a todo por su rol).
 */
import { ref, watch, computed } from 'vue'
import { useEspaciosStore, type FilaEspacioUsuario } from '@/stores/espacios'
import { useToast } from '@/composables/useToast'
import { useEscapeToClose } from '@/composables/useEscapeToClose'

const props = defineProps<{ open: boolean; userId: number; userNombre: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const espaciosStore = useEspaciosStore()
const toast = useToast()

const porRol = ref(false)
const filas = ref<FilaEspacioUsuario[]>([])
const cargando = ref(false)
const guardando = ref(false)

const abierto = computed(() => props.open)
useEscapeToClose(abierto, () => emit('close'))

watch(() => props.open, async (v) => {
  if (!v) return
  cargando.value = true
  const data = await espaciosStore.fetchEspaciosUsuario(props.userId)
  cargando.value = false
  if (!data) { toast.error('No se pudo cargar la matriz'); emit('close'); return }
  porRol.value = data.porRol
  filas.value = data.espacios
})

function onEditar(f: FilaEspacioUsuario): void { if (f.editar) f.ver = true }
function onVer(f: FilaEspacioUsuario): void { if (!f.ver) f.editar = false }

async function guardar(): Promise<void> {
  if (guardando.value) return
  guardando.value = true
  const r = await espaciosStore.saveEspaciosUsuario(
    props.userId,
    filas.value.map(f => ({ espacioId: f.espacioId, ver: f.ver, editar: f.editar })),
  )
  guardando.value = false
  if (!r.ok) { toast.error(r.message); return }
  toast.success('Espacios del usuario actualizados')
  emit('close')
}
</script>

<template>
  <Teleport defer to="ion-app">
    <div v-if="open" class="ds-modal-backdrop" @click.self="emit('close')">
      <div class="ds-modal max-w-md" role="dialog" aria-modal="true" aria-label="Espacios del usuario">
        <h2 class="text-base font-semibold text-ink mb-1">Espacios · {{ userNombre }}</h2>

        <template v-if="porRol">
          <p class="text-sm text-ink-soft py-4">
            Este usuario es administrador: entra a <strong>todos</strong> los espacios por su rol.
            Su matriz no se edita.
          </p>
          <footer class="flex justify-end">
            <button type="button" class="ds-btn-secondary" @click="emit('close')">Cerrar</button>
          </footer>
        </template>

        <template v-else>
          <p class="text-xs text-ink-soft mb-3">Editar implica ver. Sin tildes, el usuario no ve el espacio.</p>

          <div v-if="cargando" class="space-y-2"><div v-for="i in 3" :key="i" class="ds-skeleton h-9"></div></div>

          <div v-else class="border border-line rounded-lg divide-y divide-line-soft max-h-72 overflow-y-auto">
            <div v-for="f in filas" :key="f.espacioId" class="flex items-center gap-3 px-3 h-10" :class="{ 'opacity-60': !f.activo }">
              <span class="flex-1 text-sm text-ink truncate">{{ f.nombre }}{{ f.activo ? '' : ' (inactivo)' }}</span>
              <label class="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
                <input v-model="f.ver" type="checkbox" class="accent-[#0F7660]" @change="onVer(f)" /> Ve
              </label>
              <label class="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
                <input v-model="f.editar" type="checkbox" class="accent-[#0F7660]" @change="onEditar(f)" /> Edita
              </label>
            </div>
          </div>

          <footer class="flex justify-end gap-2 pt-3">
            <button type="button" class="ds-btn-secondary" @click="emit('close')">Cancelar</button>
            <button type="button" class="ds-btn-primary" :disabled="guardando || cargando" @click="guardar">
              {{ guardando ? 'Guardando…' : 'Guardar' }}
            </button>
          </footer>
        </template>
      </div>
    </div>
  </Teleport>
</template>
