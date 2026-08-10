import * as studentAuthRepository from '../repositories/studentAuthRepository';

export async function getCurrentStudentProfile(authUid: string) {
  return studentAuthRepository.getStudentProfile(authUid);
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
// dari guru. Boleh dipanggil ulang dari perangkat lain dengan kode yang
// sama — tiap perangkat dapat dokumen student_profiles sendiri yang
// menunjuk ke studentId yang sama, jadi tidak perlu login tunggal per
// perangkat.
export async function claimAccessCode(accessCode: string, authUid: string) {
  const code = accessCode.trim().toUpperCase();
  if (!code) throw new Error('Kode akses wajib diisi.');
  if (!authUid) throw new Error('Sesi tidak valid, coba muat ulang halaman.');

  const loginCode: any = await studentAuthRepository.getLoginCode(code);
  if (!loginCode) throw new Error('Kode akses tidak ditemukan. Periksa kembali kode dari gurumu.');

  // Sengaja TIDAK membaca koleksi students di sini: pemanggil belum punya
  // student_profiles, jadi rules pasti menolaknya dan seluruh alur login
  // gagal. Semua identitas yang dibutuhkan sudah disalin ke dokumen kode
  // akses saat guru membuat siswa (lihat buildLoginCodeDoc).
  if (!loginCode.className || !loginCode.name) {
    throw new Error('Kode akses ini dibuat versi lama. Minta gurumu membuat ulang kode akses.');
  }

  return studentAuthRepository.saveStudentProfile(authUid, {
    studentId: loginCode.studentId,
    workspaceId: loginCode.workspaceId,
    className: loginCode.className,
    name: loginCode.name,
    nis: loginCode.nis || '-',
  });
}
