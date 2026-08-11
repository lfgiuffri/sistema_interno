/**
 * Registry de secciones de configuración.
 *
 * Para agregar una sección nueva:
 *   1. Crear el componente en `views/dashboard/settings/sections/`.
 *   2. Importarlo acá.
 *   3. Agregar la entry al array (con id único, usado en la URL).
 *
 * El layout y la navegación lateral se generan automáticamente desde este array.
 */
import type { Component } from 'vue'
import {
  notificationsOutline,
  serverOutline,
  personCircleOutline,
  informationCircleOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons'

import NotificationsSection from './sections/NotificationsSection.vue'
import DataSection from './sections/DataSection.vue'
import AccountSection from './sections/AccountSection.vue'
import SecuritySection from './sections/SecuritySection.vue'
import AboutSection from './sections/AboutSection.vue'

/** Definición de una sección de configuración. */
export interface SettingsSectionDef {
  id: string
  label: string
  description?: string
  icon: string
  component: Component
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'notifications',
    label: 'Notificaciones',
    description: 'Push, no molestar y horario silencioso',
    icon: notificationsOutline,
    component: NotificationsSection,
  },
  {
    id: 'data',
    label: 'Datos',
    description: 'Exportación de tus datos',
    icon: serverOutline,
    component: DataSection,
  },
  {
    id: 'account',
    label: 'Perfil',
    description: 'Tus datos, contraseña y sesión',
    icon: personCircleOutline,
    component: AccountSection,
  },
  {
    id: 'security',
    label: 'Seguridad',
    description: 'Verificación en dos pasos (2FA)',
    icon: shieldCheckmarkOutline,
    component: SecuritySection,
  },
  {
    id: 'about',
    label: 'Acerca de',
    description: 'Versión y diagnóstico',
    icon: informationCircleOutline,
    component: AboutSection,
  },
]

export const DEFAULT_SECTION_ID = SETTINGS_SECTIONS[0].id
