/**
 * Menerjemahkan error Firestore SDK jadi kalimat yang bisa ditindaklanjuti
 * guru — pola yang sama dengan describeAuthError (authErrors.ts) dan
 * describeSubmissionError (submissionRules.ts).
 *
 * Kenapa ini perlu: error Firestore SELALU punya `.code` (mis.
 * "permission-denied"), dan `.message`-nya ("FirebaseError: Missing or
 * insufficient permissions.") tidak pernah ditulis untuk dibaca guru —
 * itu untuk developer. Banyak layar guru (GradesTab, JournalTab, dst.)
 * menampilkan `.message` itu APA ADANYA, sehingga penolakan server yang
 * sebenarnya bisa ditindaklanjuti (mis. sesi kedaluwarsa) terlihat seperti
 * pesan error teknis yang membingungkan.
 */

const FIRESTORE_ERROR_MESSAGES: Record<string, string> = {
  'permission-denied':
    'Perubahan ditolak server. Muat ulang halaman lalu coba lagi — kalau masih gagal, keluar dan masuk ulang akun.',
  unauthenticated: 'Sesimu sudah berakhir. Masuk ulang lalu coba lagi.',
  unavailable: 'Tidak bisa terhubung ke server. Periksa koneksi internetmu lalu coba lagi.',
  'deadline-exceeded': 'Koneksi terlalu lama merespons. Periksa internetmu lalu coba lagi.',
  cancelled: 'Proses terhenti di tengah jalan. Coba lagi.',
  internal: 'Terjadi gangguan sementara di server. Coba lagi dalam beberapa saat.',
  'resource-exhausted': 'Server sedang sibuk. Coba lagi dalam beberapa saat.',
};

export function describeFirestoreError(error: unknown, fallback: string): string {
  const candidate = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';

  if (code) {
    return FIRESTORE_ERROR_MESSAGES[code] || fallback;
  }

  // Tanpa `.code` = error yang kita lempar sendiri di kode aplikasi
  // (mis. "Kelas tidak valid." di gradeService), pesannya sudah ditulis
  // untuk dibaca apa adanya.
  const message = candidate.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
