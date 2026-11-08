import * as studentAuthRepository from '../repositories/studentAuthRepository';

export async function getCurrentStudentProfile(authUid: string) {
  return studentAuthRepository.getStudentProfile(authUid);
}

export async function getCachedStudentProfile(authUid: string) {
  return studentAuthRepository.getCachedStudentProfile(authUid);
}

// Dipanggil sedini mungkin di halaman login siswa (bukan untuk hasilnya) —
// tujuannya cuma memaksa Firestore menyelesaikan negosiasi transport
// (WebChannel vs long-polling; lihat komentar experimentalAutoDetectLongPolling
// di src/config/firebase.ts) sambil siswa masih mengetik kode akses, supaya
// waktunya tidak menumpuk di titik klik "Masuk" nanti.
export async function warmupConnection() {
  await studentAuthRepository.warmupConnection();
}

// Menautkan akun (anonim) yang baru login ke satu siswa lewat kode akses
// dari guru. Verifikasi kode + pembuatan student_profiles dilakukan di server
// (rate limited) — lihat lib/server/studentClaimService.ts. Boleh dipanggil
// ulang dari perangkat lain dengan kode yang sama: tiap perangkat dapat
// dokumen student_profiles sendiri yang menunjuk ke studentId yang sama.
export async function claimAccessCode(accessCode: string, authUid: string) {
  const code = accessCode.trim().toUpperCase();
  if (!code) throw new Error('Kode akses wajib diisi.');
  if (!authUid) throw new Error('Sesi tidak valid, coba muat ulang halaman.');

  return studentAuthRepository.claimAccessCodeOnServer(code, authUid);
}
