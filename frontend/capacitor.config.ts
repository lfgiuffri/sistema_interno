import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Configuración de Capacitor para Zero.
 * El `server.url` de dev se gatea por NODE_ENV para nunca commitear una URL de
 * desarrollo a un build de producción (best-practices §6.5).
 */
const config: CapacitorConfig = {
  appId: 'ar.com.positivemedia.sistemainterno',
  appName: 'Sistema Interno',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
