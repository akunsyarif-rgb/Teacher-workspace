// Format teks siap-tempel untuk membagikan SELURUH kode akses satu kelas
// sekaligus (mis. ke grup WhatsApp kelas) — bukan CSV/tabel, karena tujuan
// utamanya ditempel langsung ke chat, bukan diimpor ke aplikasi lain.
// Urutan mengikuti persis urutan `students` yang dilempar pemanggil (sama
// dengan urutan penomoran yang tampil di layar), supaya guru bisa
// mencocokkan baris teks dengan daftar di aplikasi tanpa bingung.
export function buildStudentCodesShareText(
  className: string,
  students: { name: string; accessCode?: string }[]
): string {
  const lines = students.map((student, index) => {
    // Siswa yang belum dibuatkan kode akses TETAP disertakan (bukan
    // dilewati) — supaya tidak ada siswa yang diam-diam hilang dari daftar
    // yang dibagikan, guru cukup melihat keterangannya lalu memakai
    // "Buatkan Kode" untuk yang tersisa.
    const code = student.accessCode || '(belum ada kode)';
    return `${index + 1}. ${student.name} — ${code}`;
  });
  return ['DAFTAR AKUN SISWA', `Kelas: ${className}`, '', ...lines].join('\n');
}
