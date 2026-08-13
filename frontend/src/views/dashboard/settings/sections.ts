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
  businessOutline,
  notificationsOutline,
  personCircleOutline,
  informationCircleOutline,
} from 'ionicons/icons'

import NegocioSection from './sections/NegocioSection.vue'
import NotificationsSection from './sections/NotificationsSection.vue'
import AccountSection from './sections/AccountSection.vue'
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
    // Primera: son los parámetros que impactan en la plata (cotización, redondeo) y en los avisos.
    id: 'negocio',
    label: 'Negocio',
    description: 'Cotización, redondeo de abonos y avisos de tareas',
    icon: businessOutline,
    component: NegocioSection,
  },
  {
    id: 'notifications',
    label: 'Notificaciones',
    description: 'Push, no molestar y horario silencioso',
    icon: notificationsOutline,
    component: NotificationsSection,
  },
  {
    id: 'account',
    label: 'Perfil',
    description: 'Tus datos, contraseña y sesión',
    icon: personCircleOutline,
    component: AccountSection,
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
