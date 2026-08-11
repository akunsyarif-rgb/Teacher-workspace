import { initializeApp, getApps, cert, type App, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

// Server-only — Firebase Admin SDK, dipakai route handler pembayaran untuk
// menulis field yang DIKUNCI dari client (plan/classLimit/seatLimit/
// planExpiresAt di firestore.rules). Admin SDK selalu bypass security
// rules, jadi file ini TIDAK BOLEH pernah di-import dari kode yang bisa
// berakhir di bundle client (komponen 'use client', dsb) — hanya dari
// Route Handler (app/api/**/route.ts).
//
// Inisialisasi sengaja LAZY (bukan dieksekusi saat modul di-import),
// supaya "npm run build" tidak gagal di lingkungan yang belum punya
// env var FIREBASE_ADMIN_SERVICE_ACCOUNT (mis. CI/lokal) — error baru
// muncul saat benar-benar dipanggil di request runtime.
let cachedApp: App | null = null;

function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length) {
    cachedApp = getApps()[0];
    return cachedApp;
  }

  // Mode emulator: firebase-tools emulators:exec otomatis men-set env var
  // ini untuk seluruh proses anak (termasuk next build/next start yang
  // di-spawn dari tests/e2e/*.mjs) — Admin SDK mendeteksinya sendiri dan
  // mengarahkan SEMUA panggilan ke emulator lokal, jadi tidak perlu
  // credential sungguhan sama sekali di mode ini. Sama seperti gerbang
  // NEXT_PUBLIC_USE_FIREBASE_EMULATOR di src/config/firebase.ts (client),
  // cuma Admin SDK mendeteksi emulator lewat env var standarnya sendiri,
  // bukan connect*Emulator() manual. Produksi (Vercel) tidak pernah
  // punya FIRESTORE_EMULATOR_HOST ter-set, jadi ini tidak bisa
  // diam-diam aktif di luar konteks emulator/testing.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    cachedApp = initializeApp({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-teacher-workspace',
    });
    return cachedApp;
  }

  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      'FIREBASE_ADMIN_SERVICE_ACCOUNT belum di-set. Tambahkan sebagai environment variable di Vercel — isi dengan seluruh JSON service account Firebase (bisa pakai service account yang sama dengan yang dipakai deploy Firestore rules).'
    );
  }

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT tidak valid — pastikan isinya JSON service account yang lengkap.');
  }

  cachedApp = initializeApp({ credential: cert(serviceAccount) });
  return cachedApp;
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
