import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8100';

/**
 * Config dedicada al TOUR VISUAL headed en Chrome real.
 *
 * - NO usa globalSetup (el stack ya corre LIVE y el tenant de fixture existe).
 * - `channel: 'chrome'` + `headless: false` + `slowMo` → el usuario ve el navegador
 *   recorriendo la app en tiempo real.
 * - `HEADLESS=1` en el entorno degrada a headless (fallback si no hay display),
 *   pero igual corre TODO el tour y saca todos los screenshots.
 */
const headless = process.env.HEADLESS === '1';

export default defineConfig({
  testDir: './tests/ui',
  testMatch: /visual-fulltour\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 300_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: FRONTEND_URL,
    channel: 'chrome',
    headless,
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    // Ningún goto/acción debe colgar hasta el timeout global: límites por operación.
    // (El shell mantiene un Socket.IO abierto → el evento 'load' puede no dispararse nunca.)
    navigationTimeout: 20_000,
    actionTimeout: 15_000,
    launchOptions: {
      slowMo: 350,
      args: ['--no-sandbox', '--start-maximized'],
    },
  },
});
