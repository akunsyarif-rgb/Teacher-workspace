import * as studentAuthRepository from '../repositories/studentAuthRepository';
import * as studentRepository from '../repositories/studentRepository';

export async function getCurrentStudentProfile(authUid: string) {
  return studentAuthRepository.getStudentProfile(authUid);
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

  const student: any = await studentRepository.getStudentById(loginCode.studentId);
  if (!student) throw new Error('Data siswa untuk kode ini tidak ditemukan.');

  return studentAuthRepository.saveStudentProfile(authUid, {
    studentId: student.id,
    workspaceId: loginCode.workspaceId,
    className: student.className,
    name: student.name,
  });
}
