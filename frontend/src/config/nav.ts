/**
 * Menú lateral: FUENTE ÚNICA de los grupos y sus ítems.
 *
 * Vive fuera del shell porque lo consumen dos lugares:
 *  - `AppShell.vue`, para pintar el menú filtrado por permisos.
 *  - el router, para decidir a dónde mandar a alguien que NO puede ver el panel (la vista
 *    por defecto): en vez de una pantalla vacía, entra a la primera opción que sí tiene.
 *
 * Agregar una pantalla al menú = sumar la entrada acá + su ruta en `router/index.ts`.
 */
import {
  gridOutline, peopleOutline, shieldCheckmarkOutline,
  settingsOutline, briefcaseOutline, layersOutline, gitBranchOutline, receiptOutline,
  walletOutline, documentTextOutline, folderOpenOutline, calendarOutline,
  checkboxOutline, albumsOutline, personOutline, cashOutline, trendingUpOutline,
  calendarNumberOutline, cardOutline, statsChartOutline, libraryOutline, serverOutline,
  globeOutline, analyticsOutline,
} from 'ionicons/icons'

export interface NavItem {
  label: string
  path: string
  icon: string
  /** Prefijo de módulo cuyas capabilities habilitan el ítem; null = siempre visible. */
  module: string | null
  /**
   * Capability EXACTA que habilita el ítem. Cuando está, manda sobre `module`: sirve para
   * las pantallas que no se otorgan con «tener algo del módulo» sino con un permiso propio
   * (ej. Análisis de tareas, que muestra métricas del equipo y no el tablero).
   */
  cap?: string
}
export interface NavGroup { label: string; items: NavItem[] }

/** Las dos preguntas de permisos que necesita el menú (las expone el store `me`). */
export interface Permisos {
  can: (cap: string) => boolean
  canAny: (moduleKey: string) => boolean
}

/**
 * ¿Se ve este ítem? Con `cap` se exige esa capability exacta; si no, alcanza con tener
 * alguna del módulo. Sin módulo, siempre visible (Configuración).
 * @param item - Ítem del menú.
 * @param p - Permisos del usuario.
 * @returns true si hay que pintarlo.
 */
const visible = (item: NavItem, p: Permisos): boolean => {
  if (item.cap) return p.can(item.cap)
  return item.module === null || p.canAny(item.module)
}

/** Grupos del menú (mismos grupos que el sistema legado). */
export const NAV: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      // El panel también se otorga por permiso (`dashboard:read`): sin él, el usuario ni
      // siquiera ve la entrada y el router lo manda a su primera pantalla disponible.
      { label: 'Panel', path: '/panel', icon: gridOutline, module: 'dashboard' },
      { label: 'Estadísticas', path: '/estadisticas', icon: statsChartOutline, module: 'estadisticas' },
    ],
  },
  {
    label: 'General',
    items: [
      { label: 'Clientes', path: '/clientes', icon: briefcaseOutline, module: 'clientes' },
      { label: 'Servicios', path: '/servicios', icon: layersOutline, module: 'servicios' },
      { label: 'Áreas', path: '/areas', icon: gitBranchOutline, module: 'areas' },
    ],
  },
  {
    label: 'Abonos',
    items: [
      { label: 'Abonos', path: '/abonos', icon: walletOutline, module: 'abonos' },
      { label: 'Facturaciones', path: '/facturaciones', icon: documentTextOutline, module: 'facturaciones' },
      { label: 'Formas de facturación', path: '/formas-facturacion', icon: receiptOutline, module: 'formas-facturacion' },
    ],
  },
  {
    // Proyectos concentra todo el trabajo de entrega: el proyecto, su cobranza, las
    // tareas del equipo y la documentación asociada.
    label: 'Proyectos',
    items: [
      { label: 'Proyectos', path: '/proyectos', icon: folderOpenOutline, module: 'proyectos' },
      { label: 'Grilla de cobranzas', path: '/grilla-cobranzas', icon: calendarOutline, module: 'cobranzas' },
      { label: 'Tareas', path: '/tareas', icon: checkboxOutline, module: 'tareas' },
      { label: 'Análisis de tareas', path: '/tareas/analisis', icon: analyticsOutline, module: 'tareas', cap: 'tareas:analisis' },
      { label: 'Documentación', path: '/documentacion', icon: libraryOutline, module: 'documentacion' },
    ],
  },
  {
    label: 'Mantenimiento',
    items: [
      { label: 'Servidores', path: '/mantenimiento/servidores', icon: serverOutline, module: 'servidores' },
      { label: 'Sitios web', path: '/mantenimiento/sitios', icon: globeOutline, module: 'sitios' },
    ],
  },
  {
    label: 'Equipo',
    items: [
      { label: 'Empleados', path: '/empleados', icon: personOutline, module: 'empleados' },
      { label: 'Sueldos', path: '/sueldos', icon: cashOutline, module: 'sueldos' },
      { label: 'Aumentos', path: '/sueldos/aumentos', icon: trendingUpOutline, module: 'aumentos' },
      { label: 'Planificación', path: '/sueldos/planificacion', icon: calendarNumberOutline, module: 'planificacion' },
      { label: 'Cuentas', path: '/sueldos/cuentas', icon: cardOutline, module: 'cuentas' },
    ],
  },
  {
    label: 'Administración',
    items: [
      { label: 'Espacios de trabajo', path: '/espacios', icon: albumsOutline, module: 'espacios' },
      { label: 'Espacios de docs', path: '/documentacion/espacios', icon: libraryOutline, module: 'doc-espacios' },
      { label: 'Usuarios', path: '/usuarios', icon: peopleOutline, module: 'usuarios' },
      { label: 'Roles', path: '/roles', icon: shieldCheckmarkOutline, module: 'roles' },
      { label: 'Configuración', path: '/configuracion', icon: settingsOutline, module: null },
    ],
  },
]

/**
 * Grupos visibles para un usuario (se filtran los ítems sin permiso y los grupos vacíos).
 * @param p - Permisos del usuario (`can` / `canAny` del store `me`).
 * @returns Los grupos que hay que pintar.
 */
export function gruposVisibles(p: Permisos): NavGroup[] {
  return NAV
    .map(g => ({ ...g, items: g.items.filter(i => visible(i, p)) }))
    .filter(g => g.items.length > 0)
}

/**
 * Primera pantalla que el usuario puede ver, en el orden del menú. Es el destino de quien
 * entra sin permiso para el panel; si no puede ver NADA, cae igual en el panel (que muestra
 * el cartel de "no hay nada para vos con los permisos de tu rol").
 * @param p - Permisos del usuario (`can` / `canAny` del store `me`).
 * @returns Path al que redirigir.
 */
export function primeraRutaVisible(p: Permisos): string {
  const grupos = gruposVisibles(p)
  // Configuración es el único ítem sin permiso (siempre visible): sirve de destino final,
  // pero solo si no hay ninguna pantalla de trabajo disponible.
  const conPermiso = grupos.flatMap(g => g.items).filter(i => i.module !== null)
  return conPermiso[0]?.path ?? grupos.flatMap(g => g.items)[0]?.path ?? '/panel'
}
