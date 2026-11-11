import type { Metadata } from 'next';
import LegalDocument, { type LegalSection } from '@/src/components/legal/LegalDocument';
import { LEGAL_PLACEHOLDERS as P, LEGAL_PATHS } from '@/lib/config/legal';

export const metadata: Metadata = { title: 'Kebijakan Privasi — Teacher Workspace' };

// DRAF — lihat catatan di lib/config/legal.ts. Placeholder [dalam kurung siku] harus diisi sebelum rilis.
export const SECTIONS: LegalSection[] = [
  {
    heading: `Siapa yang bertanggung jawab`,
    paragraphs: [
      `Layanan dioperasikan oleh ${P.entity}, beralamat di ${P.address}. Kontak: ${P.email}.`,
      `Untuk data akun guru, kami bertindak sebagai Pengendali Data Pribadi. Untuk data siswa dan data kelas yang dimasukkan guru, sekolah/guru pemilik workspace adalah Pengendali Data Pribadi dan kami bertindak sebagai Prosesor yang mengikuti instruksi mereka.`,
    ],
  },
  {
    heading: `Data yang kami proses`,
    items: [
      `Akun guru: email, nama, mata pelajaran, peran (pemilik/admin/guru), dan kelas yang diwalikan.`,
      `Data kelas dan siswa: nama siswa, NIS, kelas, dan kode akses siswa.`,
      `Data akademik: presensi, jurnal mengajar, nilai, tugas dan jawaban siswa (termasuk teks, foto, dan dokumen yang dilampirkan), pengumuman, serta jadwal.`,
      `Data pembinaan wali kelas: catatan wali kelas/konseling, prestasi, kas kelas, dan inventaris kelas. Catatan konseling tidak pernah ditampilkan kepada siswa.`,
      `Data pembayaran: status dan nominal transaksi. Pembayaran diproses oleh Midtrans; kami tidak menyimpan nomor kartu atau kredensial pembayaran Anda.`,
      `Data teknis: log kesalahan dan keamanan, alamat IP (untuk membatasi percobaan masuk yang berulang), serta informasi perangkat dan peramban.`,
    ],
  },
  {
    heading: `Tujuan dan dasar pemrosesan`,
    paragraphs: [
      `Kami memproses data untuk menyediakan dan mengamankan layanan, memproses pembayaran paket, memberikan dukungan, memperbaiki kesalahan, dan memenuhi kewajiban hukum.`,
      `Dasar pemrosesan adalah persetujuan Anda saat mendaftar, pelaksanaan perjanjian layanan, kepentingan yang sah untuk keamanan dan pencegahan penyalahgunaan, serta kewajiban hukum. Kami tidak memakai data untuk iklan dan tidak menjual data pribadi.`,
    ],
  },
  {
    heading: `Data anak dan siswa`,
    paragraphs: [
      `Siswa umumnya masih di bawah umur. Sekolah/guru yang memasukkan data siswa bertanggung jawab memastikan adanya dasar yang sah, termasuk persetujuan orang tua/wali bila diperlukan.`,
      `Siswa masuk memakai kode akses dari guru dan hanya dapat melihat data kelasnya serta data miliknya sendiri. Kami menyarankan sekolah tidak memasukkan data siswa yang tidak diperlukan.`,
    ],
  },
  {
    heading: `Pihak ketiga yang membantu kami`,
    paragraphs: [
      `Kami memakai penyedia berikut sebagai prosesor untuk menjalankan layanan:`,
    ],
    items: [
      `Google Firebase / Google Cloud — autentikasi, basis data, dan penyimpanan berkas.`,
      `Supabase — penyimpanan lampiran jawaban siswa dan modul ulangan harian.`,
      `Vercel — hosting aplikasi.`,
      `Midtrans — pemrosesan pembayaran.`,
      `Penyedia pemantauan kesalahan (mis. Sentry) — hanya bila diaktifkan; data yang dikirim disaring dari kata sandi, token, dan pola rahasia.`,
    ],
  },
  {
    heading: `Transfer lintas negara`,
    paragraphs: [
      `Server penyedia di atas dapat berada di luar Indonesia. Kami memilih penyedia yang menerapkan perlindungan memadai dan hanya mengirim data yang diperlukan untuk menjalankan layanan.`,
    ],
  },
  {
    heading: `Penyimpanan dan penghapusan`,
    items: [
      `Data disimpan selama akun/workspace aktif.`,
      `Item yang dihapus guru masuk ke Sampah dan dapat dipulihkan; pemilik atau admin dapat menghapusnya permanen, dan penghapusan permanen tidak dapat dibatalkan.`,
      `Cadangan (backup) disimpan selama ${P.backupRetention} sehingga data yang dihapus permanen dapat masih ada di cadangan selama periode itu.`,
      `Setelah akun/workspace ditutup, data dihapus dalam ${P.closureRetention}, kecuali kami wajib menyimpannya menurut hukum.`,
    ],
  },
  {
    heading: `Keamanan`,
    paragraphs: [
      `Kami menerapkan pengamanan yang wajar: koneksi terenkripsi (HTTPS), pemisahan data antar sekolah, kontrol akses berbasis peran yang ditegakkan di server, kode akses acak dengan pembatasan percobaan, dan pencatatan keamanan. Tidak ada sistem yang sepenuhnya bebas risiko; jaga kerahasiaan kata sandi dan kode akses.`,
    ],
  },
  {
    heading: `Hak Anda`,
    paragraphs: [
      `Anda berhak meminta akses, perbaikan, pembatasan, penghapusan, dan portabilitas data pribadi, menarik persetujuan, serta mengajukan keberatan. Aplikasi menyediakan menu Backup & Ekspor Data untuk mengunduh data workspace.`,
      `Untuk data siswa, ajukan permintaan melalui sekolah/guru Anda; untuk data akun guru, hubungi kami di ${P.email}. Kami menanggapi sesuai batas waktu menurut peraturan.`,
    ],
  },
  {
    heading: `Pemberitahuan kegagalan pelindungan data`,
    paragraphs: [
      `Bila terjadi kegagalan pelindungan data pribadi, kami akan memberi tahu pihak yang terdampak dan pihak berwenang tanpa penundaan dan dalam batas waktu yang ditetapkan peraturan.`,
    ],
  },
  {
    heading: `Penyimpanan lokal peramban`,
    paragraphs: [
      `Kami memakai penyimpanan lokal/IndexedDB peramban untuk menjaga sesi masuk dan cache offline. Kami tidak memakai pelacak iklan pihak ketiga.`,
    ],
  },
  {
    heading: `Perubahan kebijakan`,
    paragraphs: [
      `Kami dapat memperbarui kebijakan ini. Perubahan material akan diumumkan di aplikasi dan versi yang berlaku tercantum di bagian atas halaman ini.`,
    ],
  },
  {
    heading: `Kontak`,
    paragraphs: [
      `Pertanyaan atau permintaan terkait privasi: ${P.email}.`,
    ],
  },
];

export default function Page() {
  return (
    <LegalDocument
      title={`Kebijakan Privasi`}
      intro={`Kebijakan ini menjelaskan bagaimana Teacher Workspace ("kami") memproses data pribadi saat Anda memakai aplikasi untuk guru (Teacher Workspace) dan aplikasi pendamping siswa (Student Companion). Kami berupaya mematuhi Undang-Undang No. 27 Tahun 2022 tentang Pelindungan Data Pribadi dan peraturan turunannya.`}
      sections={SECTIONS}
      other={{ href: LEGAL_PATHS.terms, label: 'Baca Syarat dan Ketentuan' }}
    />
  );
}
