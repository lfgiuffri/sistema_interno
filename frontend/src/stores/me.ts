/**
 * Store de contexto de sesión (permission-aware).
 *
 * Trae de `GET /me` el usuario, los módulos cargados y las capabilities de su rol.
 * Es la fuente de verdad para la navegación dinámica y el gating de acciones en la UI:
 * el menú se filtra con `can()` y los botones se ocultan con `can('<modulo>:<accion>')`.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/services/api'
import type { MeContext, User, AppModule } from '@/types'

export const useMeStore = defineStore('me', () => {
  const user = ref<User | null>(null)
  const modules = ref<AppModule[]>([])
  const capabilities = ref<string[]>([])
  const declaredCapabilities = ref<string[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  /** `['*']` en capabilities significa acceso total (rol Administrador). */
  const isAdmin = computed(() => capabilities.value.includes('*'))

  /** Iniciales del usuario para el avatar. */
  const initials = computed(() => {
    if (!user.value) return ''
    const a = user.value.name?.charAt(0) ?? ''
    const b = user.value.lastName?.charAt(0) ?? ''
    return (a + b).toUpperCase()
  })

  /**
   * Carga el contexto del usuario actual desde el backend.
   * Idempotente: vuelve a pedir `/me` cada vez para reflejar cambios de permisos.
   * @returns Promesa que resuelve cuando el contexto quedó cargado.
   */
  async function loadContext(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/me')
      if (data.success) {
        const ctx: MeContext = data.data
        user.value = ctx.user ?? null
        modules.value = Array.isArray(ctx.modules) ? ctx.modules : []
        capabilities.value = Array.isArray(ctx.capabilities) ? ctx.capabilities : []
        declaredCapabilities.value = Array.isArray(ctx.declaredCapabilities) ? ctx.declaredCapabilities : []
        loaded.value = true
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * Indica si el usuario tiene una capability concreta.
   * @param cap - Capability con formato `modulo:accion` (ej: 'usuarios:create').
   * @returns true si la tiene o si posee el comodín `*`.
   */
  function can(cap: string): boolean {
    return isAdmin.value || capabilities.value.includes(cap)
  }

  /**
   * Indica si el usuario tiene ALGUNA capability de un módulo (para mostrar
   * la entrada del menú aunque solo tenga lectura).
   * @param moduleKey - Prefijo del módulo (ej: 'usuarios').
   * @returns true si tiene al menos una capability de ese módulo.
   */
  function canAny(moduleKey: string): boolean {
    if (isAdmin.value) return true
    return capabilities.value.some(c => c.startsWith(`${moduleKey}:`))
  }

  /** Limpia el contexto (al cerrar sesión). */
  function reset(): void {
    user.value = null
    modules.value = []
    capabilities.value = []
    declaredCapabilities.value = []
    loaded.value = false
  }

  return {
    user,
    modules,
    capabilities,
    declaredCapabilities,
    loading,
    loaded,
    isAdmin,
    initials,
    can,
    canAny,
    loadContext,
    reset,
  }
})
