/**
 * Router del Sistema Interno (single-tenant).
 *
 * Rutas: /login (pública) y el área de trabajo bajo AppShell (menú lateral permission-aware).
 * Todas las views se cargan lazy para hacer code-splitting por ruta.
 */
import { createRouter, createWebHistory } from '@ionic/vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/panel' },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginPage.vue'),
    meta: { guest: true },
  },
  {
    // Área de trabajo: shell con menú lateral. Cada hija declara el módulo al que
    // pertenece (meta.module) para el gating visual; el backend igual corta por capability.
    path: '/',
    component: () => import('@/views/AppShell.vue'),
    meta: { auth: true },
    children: [
      { path: 'panel', name: 'Panel', component: () => import('@/views/dashboard/HomePage.vue') },
      { path: 'estadisticas', name: 'Estadisticas', component: () => import('@/views/dashboard/EstadisticasPage.vue'), meta: { module: 'facturaciones' } },
      { path: 'abonos', name: 'Abonos', component: () => import('@/views/abonos/AbonosPage.vue'), meta: { module: 'abonos' } },
      { path: 'abonos/nuevo', name: 'AbonoNuevo', component: () => import('@/views/abonos/AbonoFormPage.vue'), meta: { module: 'abonos' } },
      { path: 'abonos/:id/editar', name: 'AbonoEditar', component: () => import('@/views/abonos/AbonoFormPage.vue'), meta: { module: 'abonos' } },
      { path: 'facturaciones', name: 'Facturaciones', component: () => import('@/views/abonos/FacturacionesPage.vue'), meta: { module: 'facturaciones' } },
      { path: 'proyectos', name: 'Proyectos', component: () => import('@/views/proyectos/ProyectosPage.vue'), meta: { module: 'proyectos' } },
      { path: 'proyectos/nuevo', name: 'ProyectoNuevo', component: () => import('@/views/proyectos/ProyectoFormPage.vue'), meta: { module: 'proyectos' } },
      { path: 'proyectos/:id/editar', name: 'ProyectoEditar', component: () => import('@/views/proyectos/ProyectoFormPage.vue'), meta: { module: 'proyectos' } },
      { path: 'proyectos/:id/cobranzas', name: 'Cobranzas', component: () => import('@/views/proyectos/CobranzasPage.vue'), meta: { module: 'cobranzas' } },
      { path: 'grilla-cobranzas', name: 'GrillaCobranzas', component: () => import('@/views/proyectos/GrillaCobranzasPage.vue'), meta: { module: 'cobranzas' } },
      { path: 'tareas', name: 'Tareas', component: () => import('@/views/tareas/TareasHomePage.vue'), meta: { module: 'tareas' } },
      { path: 'tareas/resumen', name: 'TareasResumen', component: () => import('@/views/tareas/ResumenPage.vue'), meta: { module: 'tareas' } },
      { path: 'tareas/espacios/:eid', name: 'Listas', component: () => import('@/views/tareas/ListasPage.vue'), meta: { module: 'tareas' } },
      { path: 'tareas/espacios/:eid/listas/:lid', name: 'TareasLista', component: () => import('@/views/tareas/TareasListaPage.vue'), meta: { module: 'tareas' } },
      { path: 'documentacion', name: 'Documentacion', component: () => import('@/views/documentacion/DocumentacionHomePage.vue'), meta: { module: 'documentacion' } },
      { path: 'documentacion/espacios', name: 'DocEspacios', component: () => import('@/views/documentacion/DocEspaciosPage.vue'), meta: { module: 'doc-espacios' } },
      // ⚠️ Los parámetros se llaman `deid`/`dlid` y NO `eid`/`lid` a propósito. Con los mismos
      // nombres que las rutas de tareas (`tareas/espacios/:eid/listas/:lid`), el router-outlet
      // de Ionic confundía las vistas cacheadas: entrar a una lista de documentación después
      // de haber visitado una lista de tareas terminaba renderizando —y navegando a—
      // `/tareas/espacios/<id>`. Verificado A/B; si los renombrás, vuelve el bug.
      { path: 'documentacion/espacios/:deid', name: 'DocListas', component: () => import('@/views/documentacion/DocListasPage.vue'), meta: { module: 'documentacion' } },
      { path: 'documentacion/espacios/:deid/listas/:dlid', name: 'DocDocumentos', component: () => import('@/views/documentacion/DocumentosPage.vue'), meta: { module: 'documentacion' } },
      { path: 'espacios', name: 'Espacios', component: () => import('@/views/espacios/EspaciosPage.vue'), meta: { module: 'espacios' } },
      { path: 'empleados', name: 'Empleados', component: () => import('@/views/empleados/EmpleadosPage.vue'), meta: { module: 'empleados' } },
      { path: 'empleados/nuevo', name: 'EmpleadoNuevo', component: () => import('@/views/empleados/EmpleadoFormPage.vue'), meta: { module: 'empleados' } },
      { path: 'empleados/:id', name: 'EmpleadoFicha', component: () => import('@/views/empleados/EmpleadoFichaPage.vue'), meta: { module: 'empleados' } },
      { path: 'empleados/:id/editar', name: 'EmpleadoEditar', component: () => import('@/views/empleados/EmpleadoFormPage.vue'), meta: { module: 'empleados' } },
      { path: 'sueldos', name: 'Sueldos', component: () => import('@/views/sueldos/SueldosPage.vue'), meta: { module: 'sueldos' } },
      { path: 'sueldos/aumentos', name: 'Aumentos', component: () => import('@/views/sueldos/AumentosPage.vue'), meta: { module: 'aumentos' } },
      { path: 'sueldos/planificacion', name: 'Planificacion', component: () => import('@/views/sueldos/PlanificacionPage.vue'), meta: { module: 'planificacion' } },
      { path: 'sueldos/cuentas', name: 'Cuentas', component: () => import('@/views/sueldos/CuentasPage.vue'), meta: { module: 'cuentas' } },
      { path: 'clientes', name: 'Clientes', component: () => import('@/views/catalogos/ClientesPage.vue'), meta: { module: 'clientes' } },
      { path: 'servicios', name: 'Servicios', component: () => import('@/views/catalogos/ServiciosPage.vue'), meta: { module: 'servicios' } },
      { path: 'areas', name: 'Areas', component: () => import('@/views/catalogos/AreasPage.vue'), meta: { module: 'areas' } },
      { path: 'formas-facturacion', name: 'FormasFacturacion', component: () => import('@/views/catalogos/FormasFacturacionPage.vue'), meta: { module: 'formas-facturacion' } },
      { path: 'usuarios', name: 'Usuarios', component: () => import('@/views/UsersPage.vue'), meta: { module: 'usuarios' } },
      { path: 'roles', name: 'Roles', component: () => import('@/views/RolesPage.vue'), meta: { module: 'roles' } },
      { path: 'configuracion', name: 'Configuracion', component: () => import('@/views/dashboard/settings/SettingsLayout.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/panel' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * Destino de quien entra a la app: el panel si puede verlo, y si no, la PRIMERA pantalla
 * del menú a la que tenga acceso (antes caía en un panel vacío, sin nada y sin explicación).
 * @returns Path al que hay que ir.
 */
async function destinoInicial(): Promise<string> {
  const { useMeStore } = await import('@/stores/me')
  const me = useMeStore()
  if (!me.loaded) await me.loadContext()
  if (me.canAny('dashboard')) return '/panel'

  const { primeraRutaVisible } = await import('@/config/nav')
  return primeraRutaVisible(m => me.canAny(m))
}

// El auth store es la ÚNICA fuente de verdad de la sesión: el guard lo restaura una sola vez
// (ensureInitialized es idempotente) y decide en base a sus getters, sin leer localStorage directo.
router.beforeEach(async (to, _from, next) => {
  const { useAuthStore } = await import('@/stores/auth')
  const auth = useAuthStore()
  auth.ensureInitialized()

  if (to.meta.auth && !auth.isAuthenticated) return next('/login')
  if (to.meta.guest && auth.isAuthenticated) return next(await destinoInicial())

  // Ir al panel sin permiso para verlo (link viejo, favorito o el redirect por defecto)
  // termina en una pantalla vacía: se resuelve al primer destino disponible.
  if (to.path === '/panel' && auth.isAuthenticated) {
    const destino = await destinoInicial()
    if (destino !== '/panel') return next(destino)
  }

  return next()
})

export default router
