// Model biaya Firestore: pure (mudah diuji). Hanya bacaan/tulisan Firestore — BUKAN biaya Vercel, Supabase, Auth, Storage, Midtrans.
//
// HARGA adalah perkiraan list-price dan WAJIB diverifikasi dengan halaman harga Firestore untuk region Anda; semuanya dapat
// diganti lewat env (LOADTEST_PRICE_READ_PER_100K, LOADTEST_PRICE_WRITE_PER_100K, LOADTEST_USD_IDR).
export type Prices = { readPer100k: number; writePer100k: number; usdIdr: number; freeReadsPerDay: number; freeWritesPerDay: number };

export const DEFAULT_PRICES: Prices = {
  readPer100k: 0.06, // USD; perkiraan (multi-region AS). Region tunggal lebih murah. VERIFIKASI.
  writePer100k: 0.18, // USD; perkiraan. VERIFIKASI.
  usdIdr: 16_000, // kasar
  freeReadsPerDay: 50_000, // kuota gratis harian per project (Blaze)
  freeWritesPerDay: 20_000,
};

export type UsageProfile = {
  teachers: number;
  students: number;
  schoolDaysPerMonth: number;
  /** Berapa kali per HARI SEKOLAH tiap guru membuka tiap alur (kunci = nama skenario). */
  teacherOpensPerDay: Record<string, number>;
  /** Alur siswa per HARI SEKOLAH per siswa. */
  studentOpensPerDay: Record<string, number>;
  /** Tulisan Firestore per guru / siswa per hari sekolah (presensi + jurnal + pengumpulan, dengan autosave). */
  teacherWritesPerDay: number;
  studentWritesPerDay: number;
  /** Berapa persen siswa yang membuka aplikasi pada hari sekolah. */
  studentActiveRate: number;
};

export type ScenarioCost = { name: string; reads: number };

export type CostEstimate = {
  readsPerDay: number;
  writesPerDay: number;
  readsPerMonth: number;
  writesPerMonth: number;
  readCostUsd: number;
  writeCostUsd: number;
  totalUsd: number;
  totalIdr: number;
  /** Bacaan/hari di atas kuota gratis harian (kuota berlaku per project, bukan per sekolah). */
  billableReadsPerDay: number;
  breakdown: { name: string; actor: 'guru' | 'siswa'; readsPerDay: number; share: number }[];
};

export function estimateCost(scenarios: ScenarioCost[], usage: UsageProfile, prices: Prices = DEFAULT_PRICES): CostEstimate {
  const readsOf = new Map(scenarios.map((s) => [s.name, s.reads]));
  const breakdown: CostEstimate['breakdown'] = [];
  for (const [name, opens] of Object.entries(usage.teacherOpensPerDay)) {
    breakdown.push({ name, actor: 'guru', readsPerDay: (readsOf.get(name) ?? 0) * opens * usage.teachers, share: 0 });
  }
  for (const [name, opens] of Object.entries(usage.studentOpensPerDay)) {
    breakdown.push({ name, actor: 'siswa', readsPerDay: (readsOf.get(name) ?? 0) * opens * usage.students * usage.studentActiveRate, share: 0 });
  }
  const readsPerDay = breakdown.reduce((a, b) => a + b.readsPerDay, 0);
  breakdown.forEach((b) => (b.share = readsPerDay > 0 ? b.readsPerDay / readsPerDay : 0));
  breakdown.sort((a, b) => b.readsPerDay - a.readsPerDay);

  const writesPerDay = usage.teachers * usage.teacherWritesPerDay + usage.students * usage.studentActiveRate * usage.studentWritesPerDay;
  const readsPerMonth = readsPerDay * usage.schoolDaysPerMonth;
  const writesPerMonth = writesPerDay * usage.schoolDaysPerMonth;
  const readCostUsd = (readsPerMonth / 100_000) * prices.readPer100k;
  const writeCostUsd = (writesPerMonth / 100_000) * prices.writePer100k;
  const totalUsd = readCostUsd + writeCostUsd;
  return {
    readsPerDay, writesPerDay, readsPerMonth, writesPerMonth, readCostUsd, writeCostUsd, totalUsd,
    totalIdr: totalUsd * prices.usdIdr,
    billableReadsPerDay: Math.max(0, readsPerDay - prices.freeReadsPerDay),
    breakdown,
  };
}

/** Perkiraan lama unduh (detik) untuk `bytes` pada jaringan `kbps` (kilobit/detik). */
export function transferSeconds(bytes: number, kbps: number): number {
  return kbps > 0 ? (bytes * 8) / (kbps * 1000) : 0;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('id-ID');
}
