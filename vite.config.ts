import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: '/central-app/',
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    exclude: ['tests/e2e/**', 'node_modules/**'],
    globalSetup: ['tests/setup-fuso.ts'],
  },
});
