import { test as base, type APIRequestContext } from '@playwright/test';
import { API_BASE, ADMIN_USERNAME, ADMIN_PASSWORD, FIXTURE_USER } from '../helpers/constants';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthFixtures {
  /** APIRequestContext autenticado como el USUARIO DE FIXTURE (rol acotado: areas + usuarios:read). */
  authedApi: APIRequestContext;
  /** Tokens del usuario de fixture. */
  tokens: AuthTokens;
  /** APIRequestContext sin autenticación (tests negativos). */
  unauthApi: APIRequestContext;
  /** APIRequestContext autenticado como ADMIN (rol Administrador, capability `*`). */
  adminApi: APIRequestContext;
  /** Tokens del admin. */
  adminTokens: AuthTokens;
}

/** Cache de tokens por worker para no repetir logins. */
let cachedFixtureTokens: AuthTokens | null = null;
let cachedAdminTokens: AuthTokens | null = null;

async function loginAs(request: APIRequestContext, username: string, password: string): Promise<AuthTokens> {
  const response = await request.post(`${API_BASE}/auth/signin`, {
    data: { username, password },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Login failed for ${username} (${response.status()}): ${body}`);
  }

  const body = await response.json();
  const data = body.data || body;
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

async function getFixtureTokens(request: APIRequestContext): Promise<AuthTokens> {
  if (cachedFixtureTokens) return cachedFixtureTokens;
  cachedFixtureTokens = await loginAs(request, FIXTURE_USER.username, FIXTURE_USER.password);
  return cachedFixtureTokens;
}

async function getAdminTokens(request: APIRequestContext): Promise<AuthTokens> {
  if (cachedAdminTokens) return cachedAdminTokens;
  cachedAdminTokens = await loginAs(request, ADMIN_USERNAME, ADMIN_PASSWORD);
  return cachedAdminTokens;
}

export const test = base.extend<AuthFixtures>({
  tokens: async ({ request }, use) => {
    const tokens = await getFixtureTokens(request);
    await use(tokens);
  },

  adminTokens: async ({ request }, use) => {
    const tokens = await getAdminTokens(request);
    await use(tokens);
  },

  authedApi: async ({ playwright, tokens }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: {
        'x-access-token': tokens.accessToken,
        'Content-Type': 'application/json',
      },
    });

    await use(ctx);
    await ctx.dispose();
  },

  unauthApi: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
    await use(ctx);
    await ctx.dispose();
  },

  adminApi: async ({ playwright, adminTokens }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: `${API_BASE}/`,
      extraHTTPHeaders: {
        'x-access-token': adminTokens.accessToken,
        'Content-Type': 'application/json',
      },
    });

    await use(ctx);
    await ctx.dispose();
  },
});

export { expect } from '@playwright/test';

/** Limpia los tokens cacheados (útil para tests de expiración). */
export function clearTokenCache() {
  cachedFixtureTokens = null;
  cachedAdminTokens = null;
}
