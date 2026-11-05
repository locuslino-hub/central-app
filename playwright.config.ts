import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:4173', timezoneId: 'Europe/Lisbon', locale: 'pt-BR' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/central-app/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
