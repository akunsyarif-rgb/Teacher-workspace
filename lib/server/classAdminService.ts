import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin';
import { ApiError } from './apiErrors';
import { normalizeClassName, validateClassName } from '../utils/classNameValidation';
import { logger } from '../utils/logger';

// Semua koleksi yang punya field className langsung, TERMASUK
// student_profiles — satu-satunya alasan operasi ini harus lewat Admin
// SDK (bukan batchWrite client seperti operasi kelas lainnya): rules
// student_profiles sengaja `allow update: if false` (identitas Student
// Companion terkunci begitu ter-klaim, lihat firestore.rules). Tanpa
// merapikan className di sini juga, siswa yang sudah pernah login diam-diam
// kehilangan akses baca jurnal/presensi/pengumuman kelasnya begitu gurunya
// mengganti nama kelas, karena rules siswa mencocokkan className profil
// terhadap className dokumen yang dibaca (isStudentInClass).
export const CLASS_SCOPED_COLLECTIONS = [
  'students',
  'student_profiles',
  // student_login_codes menyimpan SALINAN className (lihat buildLoginCodeDoc
  // di studentRepository.ts) yang dipakai claimAccessCode() saat siswa
  // pertama kali klaim kodenya — bukan referensi ke dokumen students. Tanpa
  // ikut dirapikan di sini, siswa yang belum pernah login saat rename terjadi
  // akan mendapat student_profiles.className yang sudah basi begitu ia
  // akhirnya login, walau dokumen students-nya sendiri sudah benar.
  'student_login_codes',
  'journals',
  'attendances',
  'grades',
  'grade_columns',
  'schedules',
  'class_fund_transactions',
  'class_inventory',
  'student_notes',
  'assignments',
  // Dokumen submission menyimpan className juga. Tanpa ikut dirapikan,
  // pengumpulan siswa tetap membawa nama kelas lama setelah rename —
  // relasinya jadi tidak konsisten dengan tugas & nilai yang sudah ikut
  // berubah.
  'submissions',
  'announcements',
  'student_achievements',
  'session_skip_reasons',
];

// 450 pembaruan + 1 tulis dokumen job = 451 < batas 500 operasi per batch Firestore.
const RENAME_BATCH_SIZE = 450;
// Budget waktu per permintaan (maxDuration route = 60 dtk). Bila habis, permintaan
// berhenti RAPI di batas batch dan melapor `done: false`; klien memanggil lagi
// dan pekerjaan dilanjutkan dari titik terakhir.
const RENAME_TIME_BUDGET_MS = 40_000;
// Sewa (lease) kunci job. Cukup panjang untuk satu batch, cukup pendek agar
// permintaan yang mati (timeout/OOM) tidak mengunci workspace lama-lama.
const RENAME_LEASE_MS = 90_000;
const JOBS_COLLECTION = 'class_rename_jobs';

// `db` opsional HANYA untuk pengujian — pemanggil produksi tidak mengirimnya.
type AdminDbLike = ReturnType<typeof getAdminDb>;

export type RenameClassResult = {
  /** true = SEMUA dokumen sudah memakai nama baru. false = belum selesai; panggil lagi dengan nama yang sama untuk melanjutkan. */
  done: boolean;
  /** Total dokumen yang sudah dipindah ke nama baru (kumulatif lintas permintaan). */
  renamedCount: number;
  className: string;
};

type RenameJob = {
  status: 'running' | 'done' | 'failed';
  oldName: string;
  newName: string;
  startedBy: string;
  renamedCount: number;
  leaseUntil: number;
};

// TEACHER (bukan cuma OWNER/ADMIN) sengaja diizinkan — role TEACHER di
// workspace ini memang akses penuh tanpa isolasi per kelas (audit T4,
// dikonfirmasi "by design"). Penghapusan kelas jauh lebih sensitif dan
// dibatasi OWNER/ADMIN (lib/server/classLifecycleService.ts).
//
// Jaminan (dan batasnya, jujur):
//  - Tiap batch (maks 450 dokumen) ATOMIK: semua pindah atau tidak sama sekali.
//    Kelas kecil (<= 450 dokumen di satu koleksi) selesai dalam satu batch.
//  - Firestore tidak punya transaksi/batch di atas 500 operasi, jadi rename BESAR
//    tidak bisa atomik dalam satu commit. Sebagai gantinya ia DAPAT DILANJUTKAN dan
//    IDEMPOTEN: dokumen yang belum pindah masih bernama lama dan ditemukan lagi oleh
//    pemanggilan berikutnya. Penghitung progres ada di dokumen job dan ditulis di
//    batch YANG SAMA dengan datanya, jadi angkanya tidak pernah selisih dengan data.
//  - Satu rename per workspace dalam satu waktu (kunci sewa di class_rename_jobs/{workspaceId}).
//    Rename yang terputus (timeout/crash) tidak bisa tertimpa rename lain: harus diselesaikan
//    dengan memanggil ulang nama yang sama.
export async function renameClassServer(
  uid: string,
  oldNameInput: string,
  newNameInput: string,
  db?: AdminDbLike,
  options: { now?: () => number; timeBudgetMs?: number; batchSize?: number } = {}
): Promise<RenameClassResult> {
  const adminDb = db ?? getAdminDb();
  const now = options.now ?? Date.now;
  const budget = options.timeBudgetMs ?? RENAME_TIME_BUDGET_MS;
  const batchSize = options.batchSize ?? RENAME_BATCH_SIZE;
  const startedAt = now();

  const profileSnap = await adminDb.collection('teacher_profiles').doc(uid).get();
  const workspaceId = profileSnap.exists ? (profileSnap.data() as { workspaceId?: string })?.workspaceId : null;
  if (!workspaceId) {
    throw new ApiError('Akun ini belum terhubung ke workspace mana pun.', 403);
  }

  // oldName cuma dipakai untuk mencari dokumen existing (nilai className
  // yang sudah tersimpan, apa pun bentuknya) — bukan input baru dari guru,
  // jadi cukup dirapikan spasinya, tidak perlu divalidasi ulang.
  const oldName = normalizeClassName(oldNameInput);
  if (!oldName) throw new ApiError('Kelas asal tidak valid.', 400);

  // newName ADALAH input guru — validasi penuh di sini sebagai pertahanan
  // kedua (client sudah validasi juga), bukan cuma trim. Sengaja TIDAK ada
  // whitelist karakter: className bukan identifier/slug, boleh mengandung
  // spasi dan angka apa pun ("XI A KESEHATAN 1", "XI F TEKNIK 2", dst).
  const validation = validateClassName(newNameInput);
  if (!validation.valid) throw new ApiError(validation.error, 400);
  const newName = validation.value;

  if (oldName === newName) throw new ApiError('Nama kelas baru sama dengan nama sekarang.', 400);

  const jobRef = adminDb.collection(JOBS_COLLECTION).doc(workspaceId);

  // ---- 1. Ambil kunci (sewa) job untuk workspace ini, atomik.
  const lease = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const job = snap.exists ? (snap.data() as RenameJob) : null;
    const t = now();
    const sameRename = !!job && job.oldName === oldName && job.newName === newName;

    if (job && job.status === 'running') {
      if (job.leaseUntil > t) {
        throw new ApiError('Penggantian nama kelas sedang berjalan. Tunggu sebentar lalu coba lagi.', 409);
      }
      if (!sameRename) {
        throw new ApiError(
          `Ada penggantian nama kelas yang belum selesai ("${job.oldName}" → "${job.newName}"). Jalankan ulang yang itu sampai selesai dulu.`,
          409
        );
      }
      // Rename yang sama, sewa lama habis (permintaan sebelumnya mati): lanjutkan.
      tx.update(jobRef, { leaseUntil: t + RENAME_LEASE_MS, resumedBy: uid, updatedAt: FieldValue.serverTimestamp() });
      return { resumed: true, renamedCount: job.renamedCount ?? 0 };
    }

    tx.set(jobRef, {
      workspaceId,
      status: 'running',
      oldName,
      newName,
      startedBy: uid,
      renamedCount: 0,
      leaseUntil: t + RENAME_LEASE_MS,
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { resumed: false, renamedCount: 0 };
  });

  const release = async (patch: Record<string, unknown>) => {
    await jobRef.update({ ...patch, leaseUntil: 0, updatedAt: FieldValue.serverTimestamp() }).catch((e: unknown) => {
      logger.error('class_rename.release_failed', { workspaceId, err: e });
    });
  };

  try {
    // ---- 2. Pemeriksaan awal (hanya untuk rename BARU; yang dilanjutkan sudah lolos).
    if (!lease.resumed) {
      const collisionSnap = await adminDb
        .collection('students')
        .where('workspaceId', '==', workspaceId)
        .where('className', '==', newName)
        .limit(1)
        .get();
      if (!collisionSnap.empty) {
        await release({ status: 'failed', failure: 'name_exists' });
        throw new ApiError(`Kelas "${newName}" sudah ada. Pilih nama lain.`, 409);
      }
      // Kelas lama harus punya data (cek koleksi siswa dulu — jalur umum; koleksi lain bila perlu).
      let found = false;
      for (const collectionName of CLASS_SCOPED_COLLECTIONS) {
        const probe = await adminDb
          .collection(collectionName)
          .where('workspaceId', '==', workspaceId)
          .where('className', '==', oldName)
          .limit(1)
          .get();
        if (!probe.empty) {
          found = true;
          break;
        }
      }
      if (!found) {
        await release({ status: 'failed', failure: 'not_found' });
        throw new ApiError(`Kelas "${oldName}" tidak ditemukan.`, 404);
      }
    }

    // ---- 3. Pindahkan dokumen per batch. Progres = data itu sendiri (dokumen yang sudah
    // berganti nama tidak cocok lagi dengan query), jadi aman diulang kapan saja.
    for (const collectionName of CLASS_SCOPED_COLLECTIONS) {
      for (;;) {
        const snap = await adminDb
          .collection(collectionName)
          .where('workspaceId', '==', workspaceId)
          .where('className', '==', oldName)
          .limit(batchSize)
          .get();
        if (snap.empty) break;

        const batch = adminDb.batch();
        snap.docs.forEach((docSnap) => batch.update(docSnap.ref, { className: newName }));
        // Penghitung progres di batch yang SAMA dengan datanya (atomik).
        batch.update(jobRef, {
          renamedCount: FieldValue.increment(snap.docs.length),
          leaseUntil: now() + RENAME_LEASE_MS,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();

        if (now() - startedAt > budget) {
          const progress = (await jobRef.get()).data() as RenameJob;
          await release({});
          return { done: false, renamedCount: progress?.renamedCount ?? 0, className: newName };
        }
      }
    }

    // ---- 4. Selesai: semua koleksi tidak lagi punya dokumen bernama lama.
    const finalJob = (await jobRef.get()).data() as RenameJob;
    await release({ status: 'done', completedAt: FieldValue.serverTimestamp() });
    return { done: true, renamedCount: finalJob?.renamedCount ?? 0, className: newName };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Penyebab asli (pesan Firestore) hanya ke log server — tidak ke client.
    logger.error('class_rename.interrupted', { workspaceId, err: error });
    const progress = ((await jobRef.get().catch(() => null))?.data() ?? {}) as Partial<RenameJob>;
    await release({ lastError: 'batch_failed' });
    throw new ApiError(
      `Penggantian nama berhenti di tengah jalan: ${progress.renamedCount ?? 0} dokumen sudah memakai nama "${newName}", sisanya masih "${oldName}". Ulangi penggantian nama yang sama untuk melanjutkan — aman diulang.`,
      500
    );
  }
}
