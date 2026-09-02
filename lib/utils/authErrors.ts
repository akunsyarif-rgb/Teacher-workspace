/**
 * Menerjemahkan error Firebase Auth jadi kalimat yang bisa dibaca guru/siswa
 * apa adanya — murni, tanpa I/O (sama pola dengan describeSubmissionError di
 * submissionRules.ts).
 *
 * Kenapa ini perlu: error SDK Firebase Auth SELALU punya `.code` berformat
 * "auth/xxx", dan `.message`-nya ("Firebase: Error (auth/network-request-
 * failed).") tidak pernah ditulis untuk dibaca pengguna — itu untuk
 * developer. Sebelumnya app/student/login/page.tsx menampilkan `.message`
 * itu APA ADANYA ke siswa, sehingga gangguan jaringan biasa terlihat
 * seperti pesan error teknis yang menakutkan.
 *
 * Error yang kita lempar SENDIRI dari kode aplikasi (mis. claimAccessCode
 * di studentAuthService.ts: "Kode akses tidak ditemukan...") TIDAK punya
 * `.code` sama sekali — jadi dibedakan lewat ada/tidaknya `.code`, bukan
 * lewat flag terpisah seperti userFacing di submissionRules.ts, supaya
 * pemanggil lama yang sudah melempar Error biasa tidak perlu diubah.
 */

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/network-request-failed':
    'Tidak bisa terhubung ke server. Periksa koneksi internetmu (coba ganti ke WiFi atau sebaliknya) lalu coba lagi.',
  'auth/timeout': 'Koneksi terlalu lama merespons. Periksa internetmu lalu coba lagi.',
  'auth/too-many-requests': 'Terlalu banyak percobaan dalam waktu singkat. Tunggu sebentar lalu coba lagi.',
  'auth/internal-error': 'Terjadi gangguan sementara di server. Coba lagi dalam beberapa saat.',
  'auth/user-disabled': 'Akun ini dinonaktifkan. Hubungi admin sekolah.',
  'auth/invalid-email': 'Format email tidak valid.',
  // Tiga code di bawah dulunya sudah benar ditampilkan sebagai "Email atau
  // kata sandi salah" (hardcoded di app/login/page.tsx) — dipertahankan di
  // sini supaya perilaku itu tidak berubah, sekaligus kini benar-benar
  // dibedakan dari auth/network-request-failed (yang SEBELUMNYA ikut
  // ditampilkan sebagai "Email atau kata sandi salah", padahal jelas
  // salah: guru yang internetnya bermasalah tidak sedang salah ketik
  // kata sandi).
  'auth/wrong-password': 'Email atau kata sandi salah. Silakan periksa kembali.',
  'auth/user-not-found': 'Email atau kata sandi salah. Silakan periksa kembali.',
  'auth/invalid-credential': 'Email atau kata sandi salah. Silakan periksa kembali.',
};

const DEFAULT_FALLBACK = 'Gagal masuk. Periksa koneksi internetmu lalu coba lagi.';

export function describeAuthError(error: unknown, fallback: string = DEFAULT_FALLBACK): string {
  const candidate = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';

  if (code) {
    // Error dari Firebase Auth SDK — jangan pernah percaya `.message`-nya.
    return AUTH_ERROR_MESSAGES[code] || fallback;
  }

  // Tanpa `.code` = error yang kita lempar sendiri di kode aplikasi,
  // pesannya sudah ditulis untuk dibaca apa adanya.
  const message = candidate.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
