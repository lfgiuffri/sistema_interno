import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

// ─── URLs ────────────────────────────────────────────────────────────────────
// Backend en PORT (default 3010). El frontend en 8100.
export const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3010}`;
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8100';
export const API_BASE = `${BACKEND_URL}/api`;

// ─── Credenciales ─────────────────────────────────────────────────────────────
// Admin sembrado por init_db (rol Administrador con capability `*`).
export const ADMIN_USERNAME = process.env.ADMINUSER || 'admin';
export const ADMIN_PASSWORD = process.env.ADMINPASS || 'admin123';

/**
 * Usuario de FIXTURE: credenciales ESTABLES (no cambian entre corridas) para que
 * global-setup lo cree una vez con un rol acotado. Tiene capabilities de `areas`
 * y `usuarios:read`, pero NO de roles ni de escritura de usuarios — eso permite
 * probar el deny-by-default de las capabilities.
 */
export const FIXTURE_USER = {
  name: 'E2E',
  lastName: 'Fixture',
  email: process.env.E2E_USER_EMAIL || 'e2e-fixture@sistema.test',
  username: process.env.E2E_USER_USERNAME || 'e2e-fixture',
  password: process.env.E2E_USER_PASS || 'E2eFixture123456',
};

/** Rol del usuario de fixture (estable entre corridas). */
export const FIXTURE_ROLE = {
  label: 'E2E Fixture',
  description: 'Rol de pruebas E2E: áreas completo + lectura de usuarios.',
  capabilities: ['areas:read', 'areas:create', 'areas:update', 'areas:delete', 'usuarios:read'],
};

// ─── Endpoints de autenticación ───────────────────────────────────────────────
export const AUTH_ENDPOINTS = {
  signin: 'auth/signin',
  refresh: 'auth/refresh',
  changePassword: 'auth/change-password',
  mfaStatus: 'auth/mfa/status',
  // Contexto de sesión (verifyAccessToken): user + módulos + capabilities.
  me: 'me',
  myAccount: 'users/my-account',
};

// ─── Endpoints de la app (x-access-token) ─────────────────────────────────────
export const APP_ENDPOINTS = {
  me: 'me',
  areas: 'areas',
  clientes: 'clientes',
  servicios: 'servicios',
  formasFacturacion: 'formas-facturacion',
  abonos: 'abonos',
  proyectos: 'proyectos',
  espacios: 'espacios',
  empleados: 'empleados',
  sueldos: 'sueldos',
  tareas: 'tareas',
  facturaciones: 'abonos/facturaciones',
  appConfig: 'app-config',
  dashboard: 'dashboard',
  estadisticas: 'dashboard/estadisticas',
  documentacion: 'documentacion',
  docEspacios: 'documentacion/admin/espacios',
  settings: 'settings',
  users: 'users',
  roles: 'users/roles',
  rolesCatalog: 'users/roles/create',
  webhookSubscriptions: 'webhooks/subscriptions',
  webhookDeliveries: 'webhooks/deliveries',
  webhookTest: 'webhooks/test',
};

// ─── Infra / docs ─────────────────────────────────────────────────────────────
export const INFRA_ENDPOINTS = {
  root: '', // GET /api/  (mensaje de salud, sin auth)
  openapi: 'openapi.json', // GET /api/openapi.json (200)
  docs: 'docs', // GET /api/docs (Scalar UI, 200)
};

// ─── Rutas del shell (frontend) ───────────────────────────────────────────────
export const ROUTES = {
  login: '/login',
  panel: '/panel',
  usuarios: '/usuarios',
  roles: '/roles',
  settings: '/configuracion',
};

// ─── Factories de datos de prueba ─────────────────────────────────────────────

/** Payload de alta de usuario (POST /users). */
export function makeUser(overrides: Record<string, unknown> = {}) {
  const ts = Date.now();
  const rnd = Math.floor(Math.random() * 1e6);
  return {
    name: `E2E-${rnd}`,
    lastName: 'Prueba',
    email: `e2e-${ts}-${rnd}@sistema.test`,
    username: `e2e-${ts}-${rnd}`,
    password: 'E2eTest123456',
    ...overrides,
  };
}

/** Payload de alta de rol (POST /users/roles). */
export function makeRole(overrides: Record<string, unknown> = {}) {
  const ts = Date.now();
  const rnd = Math.floor(Math.random() * 1e6);
  return {
    label: `E2E Rol ${ts}-${rnd}`,
    description: 'Rol de prueba E2E',
    capabilities: ['areas:read'],
    ...overrides,
  };
}

/** Payload de alta de catálogo con nombre único (áreas/clientes/servicios/formas). */
export function makeNombre(prefix: string, overrides: Record<string, unknown> = {}) {
  const ts = Date.now();
  const rnd = Math.floor(Math.random() * 1e6);
  return { nombre: `${prefix} E2E ${ts}-${rnd}`, ...overrides };
}
