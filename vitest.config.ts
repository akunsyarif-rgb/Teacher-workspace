import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Alias '@/' sama seperti tsconfig, supaya route handler bisa diuji.
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // Semua file test berbagi satu emulator dan memanggil clearFirestore()
    // di antara test. Kalau dijalankan paralel, file yang satu menghapus
    // data seed file lainnya di tengah jalan — jadi harus berurutan.
    fileParallelism: false,
  },
});
