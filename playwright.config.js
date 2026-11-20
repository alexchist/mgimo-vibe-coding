import { defineConfig } from "@playwright/test";
const databasePath = `/tmp/orbita-playwright-${process.pid}-${Date.now()}.sqlite`;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3010",
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `PORT=3010 DATABASE_PATH=${databasePath} node server/index.mjs`,
    env: {
      APP_ORIGIN: "",
      COOKIE_SECURE: "false",
      TRUST_PROXY: "0",
      PAYMENTS_MODE: "demo",
      ALLOW_REAL_CHANNEL_LINKING: "false",
      GIGACHAT_CREDENTIALS: "",
      GIGACHAT_SCOPE: "",
      YANDEX_API_KEY: "",
      YANDEX_FOLDER_ID: "",
      YANDEX_MODEL_URI: "",
      TELEGRAM_BOT_TOKEN: "",
      VK_GROUP_TOKEN: "",
    },
    url: "http://127.0.0.1:3010/api/health",
    reuseExistingServer: false,
  },
});
