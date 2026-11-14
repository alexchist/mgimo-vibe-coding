import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:3010',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'PORT=3010 DATABASE_PATH=/tmp/orbita-playwright.sqlite node server/index.mjs',
    url: 'http://127.0.0.1:3010/api/health',
    reuseExistingServer: !process.env.CI,
  },
});
