import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // Semua file test berbagi satu emulator dan memanggil clearFirestore()
    // di antara test. Kalau dijalankan paralel, file yang satu menghapus
    // data seed file lainnya di tengah jalan — jadi harus berurutan.
    fileParallelism: false,
  },
});
