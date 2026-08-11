import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { IonicVue } from '@ionic/vue'
import * as Sentry from '@sentry/vue'
import App from './App.vue'
import router from './router/index.js'
import { setupLocalNotificationActions } from '@/composables/useNative'
import { initShareTarget } from '@/composables/useShareTarget'

/* Ionic CSS */
import '@ionic/vue/css/ionic.bundle.css'

/* Tipografía del design system (Geist, self-hosted) */
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'

/* Theme variables */
import './theme/global.css'
/* Tema claro/oscuro: importar el composable aplica la preferencia guardada al boot. */
import '@/composables/useTheme'

const pinia = createPinia()

const app = createApp(App)
  .use(IonicVue, {
    mode: 'md', // Material Design style
  })
  .use(pinia)
  .use(router)

// Observabilidad (Sentry/GlitchTip) — OPT-IN por VITE_SENTRY_DSN (build time). Sin DSN = no-op.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    app,
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0),
  })
}

// Listener de acciones de notificaciones locales SIEMPRE activo:
// si el usuario abre la app desde el botón "Listo / Posponer" de una notif
// (con la app cerrada), Capacitor entrega el evento al primer listener registrado.
setupLocalNotificationActions().catch(() => { /* ignore */ })

router.isReady().then(() => {
  app.mount('#app')
  // Share target de Android (post-mount: Pinia ya está activo)
  initShareTarget()
})
