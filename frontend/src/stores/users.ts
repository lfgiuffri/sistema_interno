/**
 * Store del módulo Usuarios (ABM).
 *
 * Listado paginado con búsqueda, alta/edición, toggle de activo y baja lógica.
 * Los mensajes de error vienen del backend (protecciones: último admin, unicidad,
 * auto-protecciones) y se exponen en `error` para que la UI los muestre tal cual.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { apiErrorMessage } from '@/services/api'
import type { User, UserInput, PaginationMeta } from '@/types'

export const useUsersStore = defineStore('users', () => {
  const users = ref<User[]>([])
  const paginate = ref<PaginationMeta | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  /**
   * Carga el listado de usuarios (paginado + búsqueda multi-palabra).
   * @param opts - { page, limit, search }.
   */
  async function fetchUsers(opts: { page?: number; limit?: number; search?: string } = {}): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.get('/users', { params: { page: opts.page ?? 1, limit: opts.limit ?? 30, search: opts.search || undefined } })
      if (data.success) {
        users.value = data.data.users
        paginate.value = data.data.paginate ?? null
      }
    } catch (e) {
      error.value = apiErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  /**
   * Crea o actualiza un usuario.
   * @param input - Datos del usuario.
   * @param id - Id a editar, u omitido para alta.
   * @returns El usuario guardado, o null si falló (mensaje en `error`).
   */
  async function saveUser(input: UserInput, id?: number): Promise<User | null> {
    saving.value = true
    error.value = ''
    try {
      const { data } = id
        ? await api.put(`/users/${id}`, input)
        : await api.post('/users', input)
      if (!data.success) { error.value = data.message; return null }
      return data.data as User
    } catch (e) {
      error.value = apiErrorMessage(e)
      return null
    } finally {
      saving.value = false
    }
  }

  /**
   * Activa/desactiva un usuario. El backend protege al último admin y a uno mismo.
   * @param id - Usuario a alternar.
   * @returns El usuario actualizado, o null si falló.
   */
  async function toggleActive(id: number): Promise<User | null> {
    error.value = ''
    try {
      const { data } = await api.patch(`/users/${id}/active`)
      if (!data.success) { error.value = data.message; return null }
      return data.data as User
    } catch (e) {
      error.value = apiErrorMessage(e)
      return null
    }
  }

  /**
   * Elimina (baja lógica) un usuario.
   * @param id - Usuario a eliminar.
   * @returns true si se eliminó.
   */
  async function deleteUser(id: number): Promise<boolean> {
    error.value = ''
    try {
      const { data } = await api.delete(`/users/${id}`)
      if (!data.success) { error.value = data.message; return false }
      return true
    } catch (e) {
      error.value = apiErrorMessage(e)
      return false
    }
  }

  /** Limpia el estado (al cerrar sesión). */
  function reset(): void {
    users.value = []
    paginate.value = null
    error.value = ''
  }

  return { users, paginate, loading, saving, error, fetchUsers, saveUser, toggleActive, deleteUser, reset }
})
