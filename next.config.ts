import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
