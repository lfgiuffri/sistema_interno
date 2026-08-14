/**
 * Limpieza de sesión: resetea TODOS los feature stores al cerrar sesión.
 *
 * Los stores de Pinia (y el singleton de settings) sobreviven al logout en una SPA, así que sin
 * un reset explícito los datos del usuario saliente quedarían visibles para el próximo que loguee
 * en el mismo navegador. Esta función centraliza esa limpieza para que los handlers de logout no
 * tengan que acordarse de cada store. Es idempotente: resetear un store vacío no hace nada.
 */
import { useMeStore } from './me'
import { useMfaStore } from './mfa'
import { useUsersStore } from './users'
import { useRolesStore } from './roles'
import { useAbonosStore } from './abonos'
import { useProyectosStore } from './proyectos'
import { useEspaciosStore } from './espacios'
import { useTareasStore } from './tareas'
import { useDocumentacionStore } from './documentacion'
import { useMantenimientoStore } from './mantenimiento'
import { useEmpleadosStore } from './empleados'
import { useSueldosStore } from './sueldos'
import { useNotificacionesStore } from './notificaciones'
import { useSettingsState } from '@/views/dashboard/settings/useSettingsState'

/** Resetea el estado de todos los feature stores (llamar junto a `authStore.logout()`). */
export function resetAllStores(): void {
  useMeStore().reset()
  useMfaStore().reset()
  useUsersStore().reset()
  useRolesStore().reset()
  useAbonosStore().reset()
  useProyectosStore().reset()
  useEspaciosStore().reset()
  useTareasStore().reset()
  useDocumentacionStore().reset()
  useMantenimientoStore().reset()
  useEmpleadosStore().reset()
  useSueldosStore().reset()
  useNotificacionesStore().reset()
  useSettingsState().reset()
}
