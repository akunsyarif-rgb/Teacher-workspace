import { estimateCost, formatNumber, transferSeconds, type CostEstimate, type Prices, type UsageProfile } from './costModel';
import type { SchoolSize } from './seed';

export type ScenarioResult = { name: string; actor: 'guru' | 'siswa'; label: string; reads: number; docs: number; bytes: number; ms: number; queries: number };

export const HEAVY_READS = 500;
export const VERY_HEAVY_READS = 2000;

export function flagFor(reads: number): '' | 'berat' | 'sangat berat' {
  return reads >= VERY_HEAVY_READS ? 'sangat berat' : reads >= HEAVY_READS ? 'berat' : '';
}

const kb = (b: number) => (b / 1024).toFixed(b > 100 * 1024 ? 0 : 1);

export function renderMarkdown(input: {
  size: SchoolSize;
  totalDocs: number;
  docsByCollection: Record<string, number>;
  results: ScenarioResult[];
  usage: UsageProfile;
  prices: Prices;
  networkKbps: number;
  scale: number;
  generatedAt: string;
}): string {
  const { results, usage, prices } = input;
  const est: CostEstimate = estimateCost(results.map((r) => ({ name: r.name, reads: r.reads })), usage, prices);
  const L: string[] = [];
  L.push('# Uji beban dan estimasi biaya Firestore');
  L.push('');
  L.push(`Dihasilkan otomatis oleh \`npm run loadtest\` pada ${input.generatedAt} (skala ${input.scale}).`);
  L.push('');
  L.push('> **Cara membaca.** Jumlah bacaan (reads), dokumen, dan ukuran data **eksak** (dihitung dari kode aplikasi yang sebenarnya terhadap data seeded). **Waktu (ms) berasal dari emulator lokal** — bukan latensi jaringan produksi; pakai kolom "perkiraan unduh" untuk gambaran di jaringan seluler. **Harga adalah perkiraan list-price: verifikasi dengan halaman harga Firestore untuk region Anda.** Biaya ini hanya Firestore (bukan Vercel, Supabase, Auth, Storage, Midtrans).');
  L.push('');
  L.push('## Data uji');
  L.push('');
  L.push(`${input.size.classes} kelas × ${input.size.studentsPerClass} siswa, ${input.size.teachers} guru, ${input.size.schoolDays} hari sekolah, ${input.size.lessonsPerClassPerDay} jam/kelas/hari. Total **${formatNumber(input.totalDocs)}** dokumen:`);
  L.push('');
  L.push('| Koleksi | Dokumen |');
  L.push('|---|---:|');
  for (const [c, n] of Object.entries(input.docsByCollection).sort((a, b) => b[1] - a[1])) L.push(`| ${c} | ${formatNumber(n)} |`);
  L.push('');
  L.push('## Biaya per alur (sekali dibuka)');
  L.push('');
  L.push(`| Alur | Pengguna | Bacaan | Query | Data (KB) | Waktu emulator (ms) | Perkiraan unduh @${input.networkKbps} kbps (dtk) | Catatan |`);
  L.push('|---|---|---:|---:|---:|---:|---:|---|');
  for (const r of results) {
    L.push(`| ${r.label} | ${r.actor} | ${formatNumber(r.reads)} | ${r.queries} | ${kb(r.bytes)} | ${Math.round(r.ms)} | ${transferSeconds(r.bytes, input.networkKbps).toFixed(1)} | ${flagFor(r.reads)} |`);
  }
  L.push('');
  L.push('## Estimasi bulanan untuk satu sekolah');
  L.push('');
  L.push(`Asumsi: ${usage.teachers} guru, ${usage.students} siswa (${Math.round(usage.studentActiveRate * 100)}% aktif per hari sekolah), ${usage.schoolDaysPerMonth} hari sekolah/bulan.`);
  L.push('');
  L.push('| Alur | Pelaku | Bacaan/hari | Porsi |');
  L.push('|---|---|---:|---:|');
  for (const b of est.breakdown) L.push(`| ${results.find((r) => r.name === b.name)?.label ?? b.name} | ${b.actor} | ${formatNumber(b.readsPerDay)} | ${(b.share * 100).toFixed(0)}% |`);
  L.push('');
  L.push('| | Per hari | Per bulan |');
  L.push('|---|---:|---:|');
  L.push(`| Bacaan | ${formatNumber(est.readsPerDay)} | ${formatNumber(est.readsPerMonth)} |`);
  L.push(`| Tulisan | ${formatNumber(est.writesPerDay)} | ${formatNumber(est.writesPerMonth)} |`);
  L.push(`| Biaya bacaan (USD) | | ${est.readCostUsd.toFixed(2)} |`);
  L.push(`| Biaya tulisan (USD) | | ${est.writeCostUsd.toFixed(2)} |`);
  L.push(`| **Total Firestore** | | **US$ ${est.totalUsd.toFixed(2)} ≈ Rp ${formatNumber(est.totalIdr)}** |`);
  L.push('');
  L.push(`Harga yang dipakai: bacaan US$ ${prices.readPer100k}/100 ribu, tulisan US$ ${prices.writePer100k}/100 ribu, kurs Rp ${formatNumber(prices.usdIdr)}/US$. Kuota gratis (${formatNumber(prices.freeReadsPerDay)} bacaan/hari per project) berlaku untuk seluruh project, bukan per sekolah — satu sekolah sebesar ini sudah ${est.billableReadsPerDay > 0 ? 'melampauinya' : 'di bawahnya'}.`);
  L.push('');
  const heavy = results.filter((r) => flagFor(r.reads));
  if (heavy.length) {
    L.push('## Temuan (alur berat)');
    L.push('');
    for (const r of heavy) L.push(`- **${r.label}**: ${formatNumber(r.reads)} bacaan, ${kb(r.bytes)} KB (${flagFor(r.reads)}).`);
    L.push('');
  }
  return L.join('\n');
}
