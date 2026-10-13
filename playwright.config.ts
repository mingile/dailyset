import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  // tests/pwa: manifest·오프라인 등 PWA 동작, tests/e2e: 앱 화면·운동 흐름. tests/helpers.ts 는 공용.
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000/dailyset",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- -H 127.0.0.1 -p 3000",
    url: "http://127.0.0.1:3000/dailyset",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
