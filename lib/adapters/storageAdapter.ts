import { auth, storage } from '@/src/config/firebase';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { withTimeout } from '../utils/withTimeout';
import { userError } from '../utils/submissionRules';
import {
  MAX_SUBMISSION_FILES,
  MAX_UPLOAD_BYTES,
  resolveUploadContentType,
} from '../utils/uploadFileTypes';

// Di-re-export supaya pemanggil lama (halaman siswa, AssignmentFormModal)
// tetap mengimpornya dari adapter ini seperti sebelumnya.
export { MAX_SUBMISSION_FILES, MAX_UPLOAD_BYTES, resolveUploadContentType };

// Upload lampiran lewat jaringan sekolah/seluler yang tidak stabil bisa
// diam-diam menggantung tanpa pernah resolve ATAUPUN reject (koneksi putus
// di tengah jalan tanpa sinyal apa pun ke browser) — uploadBytes() sendiri
// tidak punya batas waktu bawaan. Tanpa timeout ini, tombol kirim tetap
// berputar selamanya dan siswa tidak pernah tahu unggahannya gagal.
const UPLOAD_TIMEOUT_MS = 45_000;

// Foto asli dari HP (beberapa MB) via uploadBytes() single-shot pernah
// terbukti kena timeout 45 detik di atas padahal SDK Storage sendiri masih
// diam-diam mencoba ulang di baliknya (retry bawaan Storage untuk upload
// punya jatah beberapa MENIT, jauh di atas 45 detik) — akibatnya siswa
// melihat "terlalu lama" untuk upload yang sebenarnya masih berjalan wajar
// di jaringan sekolah/seluler yang lambat tapi tidak putus. Diganti ke
// uploadBytesResumable supaya progres nyata bisa dipantau: batas waktu
// dihitung dari TIDAK ADA progres sama sekali selama STALL_TIMEOUT_MS
// (koneksi benar-benar mati), bukan dari total durasi upload — upload besar
// yang lambat tapi terus bergerak tidak lagi dipotong paksa. Tetap ada batas
// mutlak (HARD_CEILING_MS) supaya tombol kirim tidak berputar selamanya
// kalau progres bergerak sangat pelan tanpa pernah benar-benar stall.
const UPLOAD_STALL_TIMEOUT_MS = 30_000;
const UPLOAD_HARD_CEILING_MS = 5 * 60_000;

function uploadFileWithStallTimeout(
  fileRef: ReturnType<typeof ref>,
  file: File,
  contentType: string,
  timeoutMessage: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(fileRef, file, { contentType });
    let stallTimer: ReturnType<typeof setTimeout>;
    let settled = false;

    const timeoutError = () =>
      Object.assign(new Error(timeoutMessage), { userFacing: true, code: 'app/timeout' });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      clearTimeout(hardTimer);
      fn();
    };

    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        task.cancel();
        finish(() => reject(timeoutError()));
      }, UPLOAD_STALL_TIMEOUT_MS);
    };

    const hardTimer = setTimeout(() => {
      task.cancel();
      finish(() => reject(timeoutError()));
    }, UPLOAD_HARD_CEILING_MS);

    armStallTimer();

    task.on(
      'state_changed',
      () => armStallTimer(),
      (error) => finish(() => reject(error)),
      () => finish(() => resolve())
    );
  });
}

// Divalidasi dua kali (di sini dan di storage.rules) bukan karena kurang
// percaya, tapi supaya siswa dapat pesan yang jelas sebelum file 10MB
// terlanjur terkirim — rules-nya sendiri tetap jadi penentu akhir.
export function validateUploadFile(file: File) {
  if (file.size >= MAX_UPLOAD_BYTES) {
    throw userError('Ukuran file maksimal 10 MB. Kecilkan dulu fotonya lalu coba lagi.');
  }
  if (!resolveUploadContentType(file)) {
    throw userError('Format file harus gambar, PDF, atau dokumen Word.');
  }
}

// Nama file dari HP bisa mengandung spasi, tanda baca, bahkan '/' yang
// akan memecah path Storage jadi folder tak terduga.
function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-80) || 'lampiran';
}

/**
 * Mengunggah lampiran jawaban tugas. Path memuat UID pengunggah karena
 * itulah yang dipakai storage.rules untuk membuktikan kepemilikan.
 */
export async function uploadSubmissionFile(
  workspaceId: string,
  assignmentId: string,
  file: File,
  // Prefix unik per file (index/timestamp) supaya beberapa foto yang
  // kebetulan bernama sama (mis. "IMG_0001.jpg" dari kamera HP) tidak
  // saling menimpa di path Storage yang sama.
  uniquePrefix?: string
) {
  validateUploadFile(file);

  const uid = auth.currentUser?.uid;
  if (!uid) throw userError('Sesi tidak valid, coba muat ulang halaman.', 'unauthenticated');

  const fileName = sanitizeFileName(file.name);
  const path = `submissions/${workspaceId}/${assignmentId}/${uid}/${uniquePrefix ? `${uniquePrefix}_${fileName}` : fileName}`;
  const fileRef = ref(storage, path);

  // contentType dikirim eksplisit dari resolveUploadContentType, BUKAN dari
  // file.type mentah: kalau HP tidak melaporkan tipe yang sah, file.type
  // yang kosong/octet-stream akan ditolak storage.rules.
  await uploadFileWithStallTimeout(
    fileRef,
    file,
    resolveUploadContentType(file) as string,
    `Unggah "${file.name}" terlalu lama, periksa koneksi internetmu lalu coba lagi.`
  );
  const url = await withTimeout(
    getDownloadURL(fileRef),
    `Gagal mengambil tautan "${file.name}", periksa koneksi internetmu lalu coba lagi.`,
    UPLOAD_TIMEOUT_MS
  );

  return { fileUrl: url, fileName: file.name, filePath: path };
}

/**
 * Mengunggah beberapa lampiran jawaban tugas sekaligus (maks
 * MAX_SUBMISSION_FILES foto/dokumen per pengumpulan).
 */
export async function uploadSubmissionFiles(
  workspaceId: string,
  assignmentId: string,
  files: File[]
) {
  if (files.length > MAX_SUBMISSION_FILES) {
    throw userError(`Maksimal ${MAX_SUBMISSION_FILES} file per pengumpulan.`);
  }
  return Promise.all(
    files.map((file, index) => uploadSubmissionFile(workspaceId, assignmentId, file, String(index)))
  );
}

/**
 * Mengunggah materi/lampiran tugas dari guru (bukan jawaban siswa). Path
 * memuat UID guru dengan alasan sama seperti uploadSubmissionFile: itulah
 * yang dipakai storage.rules untuk membuktikan kepemilikan tanpa perlu
 * firestore.get (terbukti tidak bisa diuji di Storage emulator).
 */
export async function uploadAssignmentFile(
  workspaceId: string,
  assignmentId: string,
  file: File
) {
  validateUploadFile(file);

  const uid = auth.currentUser?.uid;
  if (!uid) throw userError('Sesi tidak valid, coba muat ulang halaman.', 'unauthenticated');

  const fileName = sanitizeFileName(file.name);
  const path = `assignment-materials/${workspaceId}/${assignmentId}/${uid}/${fileName}`;
  const fileRef = ref(storage, path);

  await uploadBytes(fileRef, file, { contentType: resolveUploadContentType(file) as string });
  const url = await getDownloadURL(fileRef);

  return { materialFileUrl: url, materialFileName: file.name, materialFilePath: path };
}
