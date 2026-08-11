<script setup lang="ts">
/**
 * Shell de la app: split-pane con menú lateral permission-aware.
 *
 * El menú se arma por grupos (mismos del sistema legado) y cada ítem declara la
 * capability de lectura que lo habilita — un usuario sin permisos de un módulo no ve
 * su entrada. El footer muestra el usuario + toggle de tema + salir.
 */
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  IonPage, IonSplitPane, IonMenu, IonContent, IonRouterOutlet, menuController,
} from '@ionic/vue'
import {
  gridOutline, peopleOutline, shieldCheckmarkOutline,
  settingsOutline, logOutOutline, moonOutline, sunnyOutline,
  briefcaseOutline, layersOutline, gitBranchOutline, receiptOutline,
  walletOutline, documentTextOutline, folderOpenOutline, calendarOutline,
  checkboxOutline, albumsOutline, personOutline, cashOutline, trendingUpOutline,
  calendarNumberOutline, cardOutline,
} from 'ionicons/icons'
import { IonIcon } from '@ionic/vue'
import { useMeStore } from '@/stores/me'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import NotificacionesBell from '@/components/shared/NotificacionesBell.vue'

interface NavItem {
  label: string
  path: string
  icon: string
  /** Prefijo de módulo cuyas capabilities habilitan el ítem; null = siempre visible. */
  module: string | null
}
interface NavGroup { label: string; items: NavItem[] }

const meStore = useMeStore()
const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const { isDark, toggle: toggleTheme } = useTheme()

// Grupos del menú (se expanden por fase; mismos grupos que el sistema legado).
const NAV: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      { label: 'Panel', path: '/panel', icon: gridOutline, module: null },
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
    label: 'Proyectos',
    items: [
      { label: 'Proyectos', path: '/proyectos', icon: folderOpenOutline, module: 'proyectos' },
      { label: 'Grilla de cobranzas', path: '/grilla-cobranzas', icon: calendarOutline, module: 'cobranzas' },
    ],
  },
  {
    label: 'Tareas',
    items: [
      { label: 'Tareas', path: '/tareas', icon: checkboxOutline, module: 'tareas' },
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
      { label: 'Usuarios', path: '/usuarios', icon: peopleOutline, module: 'usuarios' },
      { label: 'Roles', path: '/roles', icon: shieldCheckmarkOutline, module: 'roles' },
      { label: 'Configuración', path: '/configuracion', icon: settingsOutline, module: null },
    ],
  },
]

/** Grupos visibles: se filtran los ítems sin permiso y los grupos vacíos. */
const visibleGroups = computed<NavGroup[]>(() =>
  NAV.map(g => ({
    ...g,
    items: g.items.filter(i => i.module === null || meStore.canAny(i.module)),
  })).filter(g => g.items.length > 0)
)

const isActive = (path: string): boolean => route.path.startsWith(path)

/** Navega y cierra el menú en mobile (en desktop el split-pane lo ignora). */
async function go(path: string): Promise<void> {
  await router.push(path)
  try { await menuController.close('main-menu') } catch { /* desktop */ }
}

function salir(): void {
  authStore.logout()
  router.replace('/login')
}

onMounted(() => {
  if (!meStore.loaded) void meStore.loadContext()
})
</script>

<template>
  <IonPage>
    <IonSplitPane content-id="main" when="lg" class="app-split">
      <IonMenu menu-id="main-menu" content-id="main" type="overlay" class="app-menu">
        <IonContent class="menu-content" :scroll-y="true">
          <div class="flex flex-col h-full bg-canvas">
            <!-- Marca -->
            <div class="flex items-center gap-2.5 px-4 pt-5 pb-4">
              <div class="w-7 h-7 rounded-md bg-accent grid place-items-center shrink-0">
                <span class="text-white text-xs font-semibold tracking-tight">PM</span>
              </div>
              <div class="leading-tight min-w-0">
                <p class="text-sm font-semibold text-ink truncate">Sistema Interno</p>
                <p class="text-2xs text-ink-faint">Positive Media</p>
              </div>
            </div>

            <!-- Navegación -->
            <nav class="flex-1 px-2.5 pb-2 overflow-y-auto">
              <div v-for="group in visibleGroups" :key="group.label" class="mb-4">
                <p class="px-2 mb-1 text-2xs font-medium uppercase tracking-wider text-ink-faint">
                  {{ group.label }}
                </p>
                <button
                  v-for="item in group.items"
                  :key="item.path"
                  class="nav-item"
                  :class="{ 'nav-item-active': isActive(item.path) }"
                  @click="go(item.path)"
                >
                  <IonIcon :icon="item.icon" class="text-[17px] shrink-0" />
                  <span>{{ item.label }}</span>
                </button>
              </div>
            </nav>

            <!-- Footer: usuario (fila 1) + acciones (fila 2) — en una sola fila el nombre
                 no entraba con los tres botones y quedaba truncado. -->
            <div class="border-t border-line px-3 py-2.5 space-y-1.5">
              <div class="flex items-center gap-2 px-1">
                <div class="w-7 h-7 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-2xs font-semibold shrink-0">
                  {{ meStore.initials || '·' }}
                </div>
                <div class="min-w-0 flex-1 leading-tight">
                  <p class="text-xs font-medium text-ink truncate">
                    {{ meStore.user?.name }} {{ meStore.user?.lastName }}
                  </p>
                  <p class="text-2xs text-ink-faint truncate">{{ meStore.user?.role?.label || '' }}</p>
                </div>
              </div>
              <div class="flex items-center justify-end gap-1 px-1">
                <NotificacionesBell />
                <button
                  class="icon-btn"
                  :title="isDark ? 'Tema claro' : 'Tema oscuro'"
                  :aria-label="isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
                  @click="toggleTheme()"
                >
                  <IonIcon :icon="isDark ? sunnyOutline : moonOutline" class="text-[16px]" />
                </button>
                <button class="icon-btn" title="Cerrar sesión" aria-label="Cerrar sesión" @click="salir">
                  <IonIcon :icon="logOutOutline" class="text-[16px]" />
                </button>
              </div>
            </div>
          </div>
        </IonContent>
      </IonMenu>

      <IonRouterOutlet id="main" />
    </IonSplitPane>
  </IonPage>
</template>

<style scoped>
.app-split {
  /* Ancho FIJO del panel lateral: sin esto Ionic usa --side-max-width: 28% y en
     monitores grandes el menú se come media pantalla. */
  --side-width: 240px;
  --side-min-width: 240px;
  --side-max-width: 240px;
}
.app-menu {
  --width: 240px;
  --background: rgb(var(--s-canvas));
  border-right: 1px solid rgb(var(--s-line));
}
.menu-content {
  --background: rgb(var(--s-canvas));
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 450;
  color: rgb(var(--s-ink-soft));
  transition: background-color 0.12s ease, color 0.12s ease;
}
.nav-item:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
.nav-item:active { transform: translateY(1px); }
.nav-item-active {
  background: rgb(var(--s-accent-soft));
  color: rgb(var(--s-accent-ink));
  font-weight: 500;
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: rgb(var(--s-ink-faint));
  transition: background-color 0.12s ease, color 0.12s ease;
}
.icon-btn:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
</style>
