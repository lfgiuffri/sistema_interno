import { test, expect } from '@playwright/test';
import { ROUTES } from '../../helpers/constants';
import { SEL } from '../../helpers/selectors';

/**
 * M1 (UI) — Login del shell del Sistema Interno.
 *
 * Mínimo y resiliente: el shell es plan-aware y su markup puede variar, así que nos apoyamos en
 * locators accesibles (rol/label) del mapa `SEL` (helpers/selectors.ts), sin acoplar a clases CSS.
 */
test.describe('M1 UI: Login', () => {
  test('M1U.1 - la página de login renderiza un formulario', async ({ page }) => {
    await page.goto(ROUTES.login);
    await page.waitForLoadState('domcontentloaded');

    // Debe existir al menos un campo de password y un botón de submit (nombre accesible vía SEL).
    const password = page.locator('input[type="password"]');
    await expect(password.first()).toBeVisible({ timeout: 10_000 });

    const submit = page.getByRole('button', { name: SEL.login.submitName });
    await expect(submit.first()).toBeVisible();
  });

  test('M1U.2 - una ruta protegida sin sesión no muestra contenido autenticado', async ({ page }) => {
    await page.goto('/areas');
    await page.waitForLoadState('domcontentloaded');
    // Sin tokens en localStorage, el shell debería redirigir a /login o mostrar el login.
    // No imponemos URL exacta (depende del guard); validamos que aparezca el campo password.
    const password = page.locator('input[type="password"]');
    await expect(password.first()).toBeVisible({ timeout: 10_000 });
  });
});
