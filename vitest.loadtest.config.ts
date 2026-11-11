import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Konfigurasi terpisah untuk uji beban/biaya (npm run loadtest) — TIDAK ikut `vitest run` biasa.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    include: ['scripts/loadtest/**/*.loadtest.ts'],
    testTimeout: 30 * 60_000,
    hookTimeout: 30 * 60_000,
    fileParallelism: false,
  },
});
