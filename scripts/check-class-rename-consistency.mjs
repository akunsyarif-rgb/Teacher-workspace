/**
 * Pemeriksa konsistensi rename kelas — HANYA MEMBACA, tidak pernah menulis.
 *
 * Dipakai saat rename kelas gagal di tengah jalan dan kita perlu tahu apakah
 * sebagian dokumen sudah memakai nama baru. Rename menyentuh 16 koleksi dan
 * commit-nya dipecah per 500 dokumen (lihat lib/server/classAdminService.ts),
 * jadi kegagalan/timeout bisa meninggalkan data setengah jalan: koleksi A
 * sudah bernama baru, koleksi B masih nama lama.
 *
 * JANGAN mengulang rename sebelum menjalankan ini — mengulang di atas rename
 * yang separuh jadi membuat keadaannya makin sulit dibaca.
 *
 * Cara pakai:
 *   FIREBASE_ADMIN_SERVICE_ACCOUNT='<isi JSON service account>' \
 *     node scripts/check-class-rename-consistency.mjs "XI A KESEHATAN 1" "XI A KESEHATAN 2"
 *
 * atau dengan berkas service account:
 *   node scripts/check-class-rename-consistency.mjs "Nama Lama" "Nama Baru" --key ./sa.json
 *
 * workspaceId opsional; tanpa itu semua workspace ikut dihitung:
 *   ... "Nama Lama" "Nama Baru" --workspace <workspaceId>
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Harus sama persis dengan CLASS_SCOPED_COLLECTIONS di
// lib/server/classAdminService.ts — kalau daftar di sana berubah, ubah juga
// di sini, kalau tidak pemeriksaan ini melewatkan koleksi.
const CLASS_SCOPED_COLLECTIONS = [
  'students',
  'student_profiles',
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

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--key' || argv[i] === '--workspace') {
      flags[argv[i].slice(2)] = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, flags };
}

// Merapikan spasi persis seperti normalizeClassName di aplikasi, supaya nama
// yang diketik di terminal cocok dengan yang tersimpan.
function normalizeClassName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function loadServiceAccount(keyPath) {
  const raw = keyPath ? readFileSync(keyPath, 'utf8') : process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (!raw) {
    console.error(
      'Service account tidak ditemukan. Set FIREBASE_ADMIN_SERVICE_ACCOUNT atau pakai --key <berkas.json>.'
    );
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error('Service account bukan JSON yang sah.');
    process.exit(1);
  }
}

async function countByClassName(db, collectionName, className, workspaceId) {
  let query = db.collection(collectionName).where('className', '==', className);
  if (workspaceId) query = query.where('workspaceId', '==', workspaceId);
  // count() hanya membaca agregat, tidak menarik isi dokumen.
  const snap = await query.count().get();
  return snap.data().count;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const oldName = normalizeClassName(positional[0]);
  const newName = normalizeClassName(positional[1]);

  if (!oldName || !newName) {
    console.error('Pemakaian: node scripts/check-class-rename-consistency.mjs "<Nama Lama>" "<Nama Baru>"');
    process.exit(1);
  }

  initializeApp({ credential: cert(loadServiceAccount(flags.key)) });
  const db = getFirestore();

  console.log(`\nMemeriksa konsistensi rename (READ-ONLY, tidak ada penulisan)`);
  console.log(`  Nama lama : "${oldName}"`);
  console.log(`  Nama baru : "${newName}"`);
  console.log(`  Workspace : ${flags.workspace || '(semua workspace)'}\n`);

  const rows = [];
  for (const collectionName of CLASS_SCOPED_COLLECTIONS) {
    try {
      const [lama, baru] = await Promise.all([
        countByClassName(db, collectionName, oldName, flags.workspace),
        countByClassName(db, collectionName, newName, flags.workspace),
      ]);
      rows.push({ collectionName, lama, baru });
    } catch (error) {
      rows.push({ collectionName, error: error?.message || 'gagal dibaca' });
    }
  }

  const lebar = Math.max(...CLASS_SCOPED_COLLECTIONS.map((c) => c.length));
  console.log(`${'KOLEKSI'.padEnd(lebar)}  NAMA LAMA  NAMA BARU`);
  console.log('-'.repeat(lebar + 22));
  for (const row of rows) {
    if (row.error) {
      console.log(`${row.collectionName.padEnd(lebar)}  ERROR: ${row.error}`);
      continue;
    }
    const tanda = row.lama > 0 && row.baru > 0 ? '  <-- CAMPUR' : '';
    console.log(
      `${row.collectionName.padEnd(lebar)}  ${String(row.lama).padStart(9)}  ${String(row.baru).padStart(9)}${tanda}`
    );
  }

  const totalLama = rows.reduce((n, r) => n + (r.lama || 0), 0);
  const totalBaru = rows.reduce((n, r) => n + (r.baru || 0), 0);
  const adaError = rows.some((r) => r.error);

  console.log('-'.repeat(lebar + 22));
  console.log(`${'TOTAL'.padEnd(lebar)}  ${String(totalLama).padStart(9)}  ${String(totalBaru).padStart(9)}\n`);

  if (adaError) {
    console.log('KESIMPULAN: sebagian koleksi gagal dibaca — hasil di atas belum lengkap.');
  } else if (totalLama > 0 && totalBaru > 0) {
    console.log('KESIMPULAN: SEPARUH TER-RENAME. Dokumen terbelah antara nama lama dan nama baru.');
    console.log('            JANGAN mengulang rename dulu — tentukan dulu nama mana yang benar,');
    console.log('            karena mengulang hanya memindahkan sisa nama lama dan menyisakan campuran.');
  } else if (totalLama === 0 && totalBaru > 0) {
    console.log('KESIMPULAN: RENAME SUDAH SELESAI SEPENUHNYA. Semua dokumen memakai nama baru,');
    console.log('            walaupun aplikasi sempat menampilkan pesan error.');
  } else if (totalLama > 0 && totalBaru === 0) {
    console.log('KESIMPULAN: RENAME BELUM TERJADI SAMA SEKALI. Semua dokumen masih memakai nama lama —');
    console.log('            aman untuk dicoba lagi.');
  } else {
    console.log('KESIMPULAN: kedua nama tidak ditemukan. Periksa ejaan nama kelas dan workspaceId.');
  }
  console.log('');
}

main().catch((error) => {
  console.error('Gagal menjalankan pemeriksaan:', error?.message || error);
  process.exit(1);
});
