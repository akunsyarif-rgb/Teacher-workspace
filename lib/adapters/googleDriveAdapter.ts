import { google } from 'googleapis';
import { Readable } from 'stream';

// Server-only — Google Drive API lewat Service Account, dipakai sebagai
// jalur upload ALTERNATIF di samping Firebase Storage (lib/adapters/
// storageAdapter.ts, yang tetap jalur utama untuk lampiran tugas). File
// yang lewat sini dibagikan sebagai "siapa saja yang punya link boleh
// lihat" — trust model yang sama dengan link Google Drive yang memang
// sudah boleh ditempel siswa sendiri (lihat lib/utils/submissionLink.ts),
// jadi tidak menambah kelas risiko baru.
//
// TIDAK BOLEH pernah di-import dari kode yang bisa berakhir di bundle
// client ('use client', dsb) — hanya dari Route Handler
// (app/api/upload/route.ts). Sama seperti lib/server/firebaseAdmin.ts.
//
// Scope sengaja 'drive.file' (bukan 'drive' penuh): Service Account cuma
// bisa melihat/mengubah file yang DIBUAT lewat scope ini, bukan seluruh
// Drive yang bisa diaksesnya — kalau kredensial ini bocor, kerusakannya
// terbatas pada folder lampiran, bukan Drive sekolah secara umum.
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let cachedDrive: ReturnType<typeof google.drive> | null = null;

function getDriveClient() {
  if (cachedDrive) return cachedDrive;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY belum di-set. Tambahkan sebagai environment variable di Vercel.'
    );
  }

  // Private key yang ditempel ke env var selalu menyimpan baris baru
  // sebagai literal "\n" (dua karakter), bukan baris baru sungguhan —
  // harus dikembalikan dulu, kalau tidak parsing JWT gagal.
  const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;

  const auth = new google.auth.JWT({ email, key: privateKey, scopes: DRIVE_SCOPES });
  cachedDrive = google.drive({ version: 'v3', auth });
  return cachedDrive;
}

export type DriveUploadResult = {
  fileId: string;
  webViewLink: string;
  fileName: string;
};

/**
 * Mengunggah satu file ke folder Drive yang ditentukan GOOGLE_DRIVE_FOLDER_ID,
 * lalu membukanya untuk siapa saja yang punya link. Dipanggil dari
 * app/api/upload/route.ts saja — pemanggil bertanggung jawab memvalidasi
 * ukuran/tipe file SEBELUM buffer sampai ke sini.
 */
export async function uploadBufferToDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<DriveUploadResult> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID belum di-set. Tambahkan sebagai environment variable di Vercel.');
  }

  const drive = getDriveClient();

  // supportsAllDrives WAJIB true: GOOGLE_DRIVE_FOLDER_ID harus berupa
  // folder di dalam SHARED DRIVE (dulu "Team Drive"), bukan folder biasa
  // di "My Drive" siapa pun — Google menonaktifkan kuota penyimpanan
  // pribadi untuk Service Account sejak 2022-an, jadi upload ke folder
  // My Drive akan gagal dengan error "Service Accounts do not have
  // storage quota" walau kredensial & izin foldernya benar. Shared Drive
  // memakai kuota organisasi (Google Workspace), bukan kuota akun mana
  // pun, sehingga Service Account bisa menulis ke sana. Tanpa parameter
  // ini juga, panggilan ke folder Shared Drive akan gagal "File not
  // found" walau folder-nya benar-benar ada. Lihat instruksi deployment
  // di .env.local.example.
  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  const fileId = created.data.id;
  if (!fileId) throw new Error('Google Drive tidak mengembalikan ID file setelah unggah.');

  // Tanpa izin ini, webViewLink cuma bisa dibuka akun Google yang satu
  // organisasi dengan Service Account — guru/siswa yang masuk pakai
  // email/kata sandi Firebase atau kode akses (bukan akun Google) tidak
  // akan pernah bisa membukanya.
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  });

  const webViewLink = created.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
  return { fileId, webViewLink, fileName };
}
