/**
 * Store del módulo Roles (ABM + matriz de capabilities).
 *
 * Un rol es un set de capabilities. El catálogo agrupado por módulo viene de
 * `GET /users/roles/create`; el rol Administrador (isSystem) es intocable y el
 * comodín `*` no es asignable — el backend lo garantiza, la UI lo refleja.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'
import type { Role, RoleInput, CapabilityGroup } from '@/types'

export const useRolesStore = defineStore('roles', () => {
  const roles = ref<Role[]>([])
  const catalog = ref<CapabilityGroup[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  /** Carga el listado de roles (con capabilities y cantidad de usuarios). */
  async function fetchRoles(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.get('/users/roles')
      if (data.success) roles.value = data.data.roles
    } catch (e) {
      error.value = apiErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  /** Carga el catálogo de capabilities agrupado por módulo (para la matriz). */
  async function fetchCatalog(): Promise<void> {
    try {
      const { data } = await api.get('/users/roles/create')
      if (data.success) catalog.value = data.data.catalog
    } catch (e) {
      error.value = apiErrorMessage(e)
    }
  }

  /**
   * Crea o actualiza un rol con su set de capabilities.
   * @param input - { label, description, capabilities }.
   * @param id - Id a editar, u omitido para alta.
   * @returns true si se guardó (mensaje de error en `error` si no).
   */
  async function saveRole(input: RoleInput, id?: number): Promise<boolean> {
    saving.value = true
    error.value = ''
    try {
      const { data } = id
        ? await api.put(`/users/roles/${id}`, input)
        : await api.post('/users/roles', input)
      if (!data.success) { error.value = data.message; return false }
      return true
    } catch (e) {
      error.value = apiErrorMessage(e)
      return false
    } finally {
      saving.value = false
    }
  }

  /**
   * Elimina un rol (el backend protege al Administrador y a roles en uso).
   * @param id - Rol a eliminar.
   * @returns true si se eliminó.
   */
  async function deleteRole(id: number): Promise<boolean> {
    error.value = ''
    try {
      const { data } = await api.delete(`/users/roles/${id}`)
      if (!data.success) { error.value = data.message; return false }
      return true
    } catch (e) {
      error.value = apiErrorMessage(e)
      return false
    }
  }

  /** Limpia el estado (al cerrar sesión). */
  function reset(): void {
    roles.value = []
    catalog.value = []
    error.value = ''
  }

  return { roles, catalog, loading, saving, error, fetchRoles, fetchCatalog, saveRole, deleteRole, reset }
})
