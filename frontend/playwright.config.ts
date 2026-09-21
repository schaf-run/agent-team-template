import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer is intentionally omitted for now: the current smoke test
  // doesn't need a live dev server. Add a `webServer` block (pointing at
  // `npm run dev`) once e2e tests start navigating real pages.
})
