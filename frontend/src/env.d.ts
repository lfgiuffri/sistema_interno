/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** Variables de entorno expuestas por Vite (`import.meta.env`). */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_SOCKET_URL?: string
  readonly VITE_AUTH0_DOMAIN?: string
  readonly VITE_AUTH0_CLIENT_ID?: string
  readonly VITE_AUTH0_REDIRECT_URI?: string
  /** Clave maestra para los endpoints de administración de plataforma (super_admin). */
  readonly VITE_MASTER_KEY?: string
  /** Site key de Cloudflare Turnstile para el captcha de signup (opcional). */
  readonly VITE_TURNSTILE_SITEKEY?: string
  /** Fuerza el modo marketing (landing) en dev/local. '1' o 'true'. Ver ADR-011. */
  readonly VITE_MARKETING?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
