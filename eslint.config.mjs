import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Utang lint yang diketahui (dicatat di STATUS.md): dijadikan peringatan, bukan galat, supaya CI bisa memblokir
  // kemunduran lain. CI memakai --max-warnings (lihat "lint:ci" di package.json): jumlah peringatan tidak boleh naik,
  // dan angkanya diturunkan seiring perapian. Tulisan baru sebaiknya tanpa `any`.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
