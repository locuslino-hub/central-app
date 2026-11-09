import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: 'http://localhost:4173',
    timezoneId: 'Europe/Lisbon',
    locale: 'pt-BR',
    // O service worker (Tarefa 22) fica desligado em todos os testes, para não guardar o app entre
    // um teste e outro nem esconder pedidos da rede. Só tests/e2e/fluxos.spec.ts o liga.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/central-app/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
