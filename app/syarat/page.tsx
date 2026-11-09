import type { Metadata } from 'next';
import LegalDocument, { type LegalSection } from '@/src/components/legal/LegalDocument';
import { LEGAL_PLACEHOLDERS as P, LEGAL_PATHS } from '@/lib/config/legal';

export const metadata: Metadata = { title: 'Syarat dan Ketentuan — Teacher Workspace' };

// DRAF — lihat catatan di lib/config/legal.ts. Placeholder [dalam kurung siku] harus diisi sebelum rilis.
export const SECTIONS: LegalSection[] = [
  {
    heading: `Layanan`,
    paragraphs: [
      `Teacher Workspace adalah alat bantu administrasi guru (jurnal, presensi, nilai, tugas, jadwal, pengumuman) dengan aplikasi pendamping untuk siswa. Layanan bukan sistem manajemen pembelajaran (LMS) maupun sistem informasi sekolah lengkap.`,
    ],
  },
  {
    heading: `Akun dan keamanan`,
    items: [
      `Anda bertanggung jawab menjaga kerahasiaan kata sandi dan kode akses serta atas aktivitas di akun Anda.`,
      `Satu akun guru hanya dapat tergabung dalam satu workspace.`,
      `Segera hubungi kami bila Anda menduga ada akses tanpa izin.`,
    ],
  },
  {
    heading: `Tanggung jawab pemilik workspace dan sekolah`,
    items: [
      `Pemilik/admin workspace mengelola siapa yang mendapat akses dan hak yang mereka miliki.`,
      `Sekolah/guru bertanggung jawab atas data siswa yang dimasukkan, termasuk memperoleh persetujuan orang tua/wali bila diperlukan dan memasukkan hanya data yang relevan.`,
      `Anda menjamin berhak memasukkan data tersebut ke layanan.`,
    ],
  },
  {
    heading: `Penggunaan yang dilarang`,
    items: [
      `Mengakses data workspace lain atau mencoba melewati batas paket dan pengamanan.`,
      `Mengunggah konten melanggar hukum, berbahaya, atau malware.`,
      `Membebani layanan secara tidak wajar atau melakukan pemindaian/penebakan kode secara otomatis.`,
      `Menggunakan layanan untuk kegiatan di luar tujuan pendidikan dan administrasi sekolah.`,
    ],
  },
  {
    heading: `Paket dan pembayaran`,
    paragraphs: [
      `Tersedia paket gratis dengan batas kelas, serta paket berbayar (sekali bayar, bulanan, dan tahunan per kursi guru). Harga dan batas paket ditampilkan di halaman Paket Berlangganan dan dapat berubah dengan pemberitahuan.`,
      `Pembayaran diproses melalui Midtrans. Paket berlangganan berlaku selama masa yang dibeli. Bila masa berlaku berakhir, batas pembuatan kelas baru kembali ke batas paket gratis; data yang sudah ada tidak dihapus dan tetap dapat dibuka.`,
      `Pengembalian dana: ${P.refund}.`,
    ],
  },
  {
    heading: `Data Anda`,
    paragraphs: [
      `Data yang Anda masukkan tetap milik Anda/sekolah Anda. Kami memprosesnya hanya untuk menyediakan layanan sesuai Kebijakan Privasi. Anda dapat mengunduh data kapan saja lewat menu Backup & Ekspor Data.`,
      `Item yang dihapus masuk ke Sampah dan dapat dipulihkan. Penghapusan permanen oleh pemilik/admin tidak dapat dibatalkan.`,
    ],
  },
  {
    heading: `Ketersediaan dan cadangan`,
    paragraphs: [
      `Kami berupaya menjaga layanan tersedia dan melakukan pencadangan berkala, tetapi tidak menjamin layanan bebas gangguan. Tingkat layanan (jika ada): [SLA / TARGET KETERSEDIAAN].`,
    ],
  },
  {
    heading: `Penangguhan dan penghentian`,
    paragraphs: [
      `Kami dapat menangguhkan atau menghentikan akses yang melanggar syarat ini atau membahayakan layanan, dengan pemberitahuan bila memungkinkan. Anda dapat berhenti memakai layanan kapan saja dan meminta penghapusan data sesuai Kebijakan Privasi.`,
    ],
  },
  {
    heading: `Kekayaan intelektual`,
    paragraphs: [
      `Aplikasi, desain, dan kodenya adalah milik ${P.entity} atau pemberi lisensinya. Anda diberi hak terbatas, tidak eksklusif, untuk memakainya selama akun aktif.`,
    ],
  },
  {
    heading: `Batasan tanggung jawab`,
    paragraphs: [
      `Sejauh diizinkan hukum, layanan diberikan "sebagaimana adanya". Kami tidak bertanggung jawab atas kerugian tidak langsung atau kehilangan data akibat hal di luar kendali wajar kami, dan tanggung jawab kami terbatas pada jumlah yang Anda bayarkan untuk layanan dalam [JANGKA WAKTU, mis. 12 bulan] terakhir.`,
    ],
  },
  {
    heading: `Hukum yang berlaku`,
    paragraphs: [
      `Syarat ini tunduk pada hukum Republik Indonesia. Sengketa diselesaikan lebih dulu secara musyawarah; bila tidak berhasil, melalui pengadilan di ${P.city}.`,
    ],
  },
  {
    heading: `Perubahan syarat`,
    paragraphs: [
      `Kami dapat memperbarui syarat ini. Perubahan material diumumkan di aplikasi; melanjutkan pemakaian setelah perubahan berarti menyetujuinya.`,
    ],
  },
  {
    heading: `Kontak`,
    paragraphs: [
      `Pertanyaan tentang syarat ini: ${P.email}.`,
    ],
  },
];

export default function Page() {
  return (
    <LegalDocument
      title={`Syarat dan Ketentuan`}
      intro={`Dengan membuat akun atau memakai Teacher Workspace, Anda menyetujui syarat berikut. Jika Anda mendaftar atas nama sekolah, Anda menyatakan berwenang mengikat sekolah pada syarat ini.`}
      sections={SECTIONS}
      other={{ href: LEGAL_PATHS.privacy, label: 'Baca Kebijakan Privasi' }}
    />
  );
}
