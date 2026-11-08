import type { NextConfig } from "next";
import { buildSecurityHeaders, originOf } from "./lib/config/securityHeaders";

const securityHeaders = buildSecurityHeaders({
  isProduction: process.env.NODE_ENV === "production",
  useEmulator: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true",
  supabaseOrigin: originOf(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
});

const nextConfig: NextConfig = {
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
