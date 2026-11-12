// Pesan gagal-simpan yang bisa dipahami guru. Pesan mentah SDK ("Missing or insufficient permissions.") tidak
// memberi tahu apa yang harus dilakukan; penyebab tersering adalah halaman/aplikasi masih memakai versi lama setelah
// pembaruan (aturan server sudah baru, aplikasi di perangkat belum), atau sesi login sudah habis.
export function describeSaveError(error: unknown, fallback = 'Gagal menyimpan.'): string {
  const e = error as { code?: string; message?: string } | null;
  const code = e?.code ?? '';
  if (code === 'permission-denied' || /insufficient permissions/i.test(e?.message ?? '')) {
    return 'Penyimpanan ditolak server. Muat ulang halaman (tutup lalu buka lagi aplikasinya) agar memakai versi terbaru, lalu coba lagi. Jika masih terjadi, keluar lalu masuk kembali.';
  }
  if (code === 'unauthenticated') return 'Sesi login habis. Muat ulang halaman atau masuk kembali, lalu coba lagi.';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'Koneksi bermasalah. Perubahan akan dicoba lagi saat koneksi kembali.';
  return e?.message || fallback;
}
