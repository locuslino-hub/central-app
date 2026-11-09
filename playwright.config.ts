import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Na publicação (CI): 2 em paralelo e até 2 novas tentativas, para os testes instáveis conhecidos
  // (calendario.spec.ts:184, chat.spec.ts:132, fluxos.spec.ts:253) não derrubarem o envio.
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 2 : 0,
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
    // Sempre um servidor novo, com o build deste código: nunca um `vite preview` velho que ficou aberto.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
