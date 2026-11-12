import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import { buildSecurityHeaders, originOf } from "./lib/config/securityHeaders";
import { dsnOrigin } from "./lib/utils/sentryReporter";

const securityHeaders = buildSecurityHeaders({
  isProduction: process.env.NODE_ENV === "production",
  useEmulator: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true",
  supabaseOrigin: originOf(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
  sentryOrigin: dsnOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN) ?? undefined,
});

// Versi build: hash commit (Vercel/GitHub) atau penanda unik per build lokal. Ditanam ke bundel klien dan route
// /api/version; beda keduanya = perangkat memakai bundel lama (lihat src/components/ui/UpdateBanner.tsx).
// Harus DETERMINISTIK (config ini dievaluasi di beberapa proses saat build): pakai SHA, bukan waktu.
function resolveAppVersion(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}
const APP_VERSION = resolveAppVersion();

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
  // Header keamanan (CSP, X-Frame-Options, Referrer-Policy, HSTS, dst) untuk semua route.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  // Fitur wali kelas dipindah ke bawah /wali-kelas/* (Fase 1A: kelompokkan
  // route wali kelas). Redirect ini menjaga link/bookmark lama tetap jalan.
  async redirects() {
    return [
      { source: "/kas-kelas", destination: "/wali-kelas/kas", permanent: false },
      { source: "/inventaris", destination: "/wali-kelas/inventaris", permanent: false },
      { source: "/konseling", destination: "/wali-kelas/konseling", permanent: false },
      { source: "/prestasi", destination: "/wali-kelas/prestasi", permanent: false },
      { source: "/komunikasi-ortu", destination: "/wali-kelas/komunikasi-ortu", permanent: false },
    ];
  },
};

export default nextConfig;
