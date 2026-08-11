import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

// Zero 2.0 backend runs on PORT (default 3010); frontend shell on 8100.
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3010}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8100';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      fullyParallel: true,
      use: {
        baseURL: `${BACKEND_URL}/api`,
      },
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      fullyParallel: false,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: FRONTEND_URL,
        viewport: { width: 1280, height: 720 },
        launchOptions: { args: ['--disable-gpu', '--no-sandbox'] },
      },
    },
    {
      name: 'websocket',
      testDir: './tests/ws',
      fullyParallel: true,
      use: {
        baseURL: BACKEND_URL,
      },
    },
  ],
});
