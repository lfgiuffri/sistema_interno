/**
 * Estado compartido de la configuración del usuario.
 *
 * Singleton liviano que carga `GET /settings` una vez y guarda los cambios con
 * un debounce contra `PUT /settings`. Lo consumen todas las secciones que editan
 * preferencias (notificaciones, etc.).
 */
import { ref } from 'vue'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'

/** Preferencias editables del usuario (genéricas del shell). */
export interface EditableSettings {
  pushEnabled: boolean
  doNotDisturbEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
}

const DEFAULTS: EditableSettings = {
  pushEnabled: true,
  doNotDisturbEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
}

let _instance: ReturnType<typeof create> | null = null

function create() {
  const toast = useToast()

  const local = ref<EditableSettings>({ ...DEFAULTS })
  const dirty = ref(false)
  const saving = ref(false)
  const lastError = ref<string | null>(null)
  let loaded = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  /** Carga las settings del backend la primera vez (idempotente). */
  async function load(): Promise<void> {
    if (loaded) return
    loaded = true
    try {
      const { data } = await api.get('/settings')
      if (data.success && data.data) {
        local.value = { ...DEFAULTS, ...data.data }
      }
    } catch {
      // Sin settings: se usan los defaults.
    }
  }

  /** Persiste las settings actuales en el backend. */
  async function flush(): Promise<void> {
    if (!dirty.value) return
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    saving.value = true
    lastError.value = null
    try {
      await api.put('/settings', local.value)
      dirty.value = false
    } catch (e) {
      lastError.value = 'Error al guardar'
      toast.error('Error al guardar')
    } finally {
      saving.value = false
    }
  }

  /**
   * Actualiza un campo y agenda el guardado con debounce.
   * @param patch - Campos parciales a aplicar al estado local.
   */
  function update(patch: Partial<EditableSettings>): void {
    local.value = { ...local.value, ...patch }
    dirty.value = true
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { void flush() }, 600)
  }

  /**
   * Resetea el estado al cerrar sesión: cancela el debounce pendiente (evita un flush con los
   * datos del usuario anterior tras el logout) y vuelve a defaults para que el próximo usuario
   * recargue sus propias settings (sin esto, `loaded` quedaba en true y se filtraban entre usuarios).
   */
  function reset(): void {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    local.value = { ...DEFAULTS }
    dirty.value = false
    saving.value = false
    lastError.value = null
    loaded = false
  }

  return { local, dirty, saving, lastError, load, flush, update, reset }
}

/** Devuelve la instancia singleton del estado de settings. */
export function useSettingsState() {
  if (!_instance) _instance = create()
  return _instance
}
