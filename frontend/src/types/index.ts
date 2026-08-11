/**
 * Tipos compartidos del frontend del Sistema Interno (single-tenant).
 *
 * Solo contiene tipos genéricos del shell (auth, contexto de sesión, usuarios, roles)
 * y el módulo de ejemplo `Item`. Cada feature nueva agrega aquí sus propios tipos.
 */

// ========== API ==========

/**
 * Envelope estándar de todas las respuestas del backend.
 * @template T Forma del campo `data`.
 */
export interface ApiEnvelope<T = unknown> {
  success: boolean
  code: number
  message: string
  data: T
  meta?: PaginationMeta | Record<string, unknown>
}

/** Metadata de paginación devuelta en `meta` para endpoints de listado. */
export interface PaginationMeta {
  totalItems: number
  limit: number
  page: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

// ========== Auth / contexto ==========

/** Rol del sistema (set de capabilities). */
export interface Role {
  id: number
  label: string
  name: string
  description?: string | null
  isSystem?: boolean
  /** Presente en el listado de roles. */
  capabilities?: string[]
  usersCount?: number
  createdAt?: string
}

/** Usuario del sistema. */
export interface User {
  id: number
  username: string
  name: string
  lastName?: string
  email?: string
  roleId?: number
  role?: Role | null
  avatar?: string | null
  avatarColor?: string | null
  active?: boolean
  mfaEnabled?: boolean
  lastLoginAt?: string | null
  createdAt?: string
}

/** Datos de sesión devueltos por los endpoints de login (signin / mfa/login). */
export interface SessionData {
  auth?: boolean
  accessToken?: string
  refreshToken?: string
  expiresIn?: string | number
  user?: User
  /** Presente cuando el login requiere un segundo factor antes de emitir tokens. */
  mfaRequired?: boolean
  mfaToken?: string
}

/** Un módulo feature cargado en el backend. */
export interface AppModule {
  key: string
  name: string
  basePath: string
}

/** Contexto del usuario actual (GET /me): quién es, módulos y capabilities. */
export interface MeContext {
  user: User
  /** Módulos feature cargados en el backend. */
  modules: AppModule[]
  /** Capabilities otorgadas al rol del usuario. `['*']` = acceso total. */
  capabilities: string[]
  /** Catálogo completo de capabilities declaradas (para la pantalla de Roles). */
  declaredCapabilities: string[]
}

/** Grupo de capabilities de un módulo (catálogo de la pantalla de Roles). */
export interface CapabilityGroup {
  module: string
  capabilities: string[]
}

// ========== Usuarios (ABM) ==========

/** Payload de alta/edición de usuario. */
export interface UserInput {
  name: string
  lastName: string
  email: string
  username: string
  /** Vacío en edición = conservar la contraseña actual. */
  password?: string
  roleId: number
  active?: boolean
}

// ========== Roles (ABM) ==========

/** Payload de alta/edición de rol. */
export interface RoleInput {
  label: string
  description?: string
  capabilities: string[]
}

// ========== Módulo de ejemplo: Items ==========

/** Estado posible de un Item. */
export type ItemStatus = 'active' | 'archived' | string

/** Registro del módulo de ejemplo `items` (template de feature CRUD). */
export interface Item {
  id: number
  name: string
  description?: string | null
  status?: ItemStatus
  createdAt?: string
  updatedAt?: string
}

/** Payload para crear/actualizar un Item. */
export interface ItemInput {
  name: string
  description?: string
  status?: ItemStatus
}

// ========== MFA (segundo factor) ==========

/** Datos del enrolamiento de 2FA (TOTP) devueltos por el backend. */
export interface MfaEnrollment {
  /** Secreto TOTP en base32 (para ingreso manual en el autenticador). */
  secret: string
  /** URI `otpauth://` para generar el QR. */
  otpauthUrl: string
  /** Códigos de respaldo de un solo uso. */
  backupCodes: string[]
}
