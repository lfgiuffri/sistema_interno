import { test as base, type Page, type APIRequestContext } from '@playwright/test';
import { ADMIN_USERNAME, ADMIN_PASSWORD, FIXTURE_USER, ROUTES, API_BASE } from '../helpers/constants';

interface AppFixtures {
  /** Página ya logueada como el usuario de fixture, lista en el panel. */
  authedPage: Page;
  /** Página logueada como admin (rol Administrador `*`). */
  adminPage: Page;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** Cache de tokens por worker — evita login en cada test. */
let workerAdminTokens: Tokens | null = null;
let workerFixtureTokens: Tokens | null = null;

async function loginForTokens(request: APIRequestContext, username: string, password: string): Promise<Tokens> {
  const res = await request.post(`${API_BASE}/auth/signin`, {
    data: { username, password },
  });
  const body = await res.json();
  const data = body.data || body;
  return { accessToken: data.accessToken, refreshToken: data.refreshToken };
}

/**
 * Inyecta los tokens en localStorage ANTES de cargar la app (addInitScript) y
 * navega al panel. Es el mismo mecanismo que usa el auth store del frontend.
 */
async function bootAuthedPage(page: Page, tokens: Tokens): Promise<void> {
  await page.addInitScript(([access, refresh]) => {
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
  }, [tokens.accessToken, tokens.refreshToken]);
  await page.goto(ROUTES.panel);
  await page.waitForLoadState('domcontentloaded');
}

export const test = base.extend<AppFixtures>({
  authedPage: async ({ page, request }, use) => {
    if (!workerFixtureTokens) {
      workerFixtureTokens = await loginForTokens(request, FIXTURE_USER.username, FIXTURE_USER.password);
    }
    await bootAuthedPage(page, workerFixtureTokens);
    await use(page);
  },

  adminPage: async ({ page, request }, use) => {
    if (!workerAdminTokens) {
      workerAdminTokens = await loginForTokens(request, ADMIN_USERNAME, ADMIN_PASSWORD);
    }
    await bootAuthedPage(page, workerAdminTokens);
    await use(page);
  },
});

export { expect } from '@playwright/test';
