import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

// Beberapa jaringan (WiFi sekolah/publik, kartu seluler tertentu) memblokir
// koneksi streaming yang dipakai Firestore secara default, sehingga muncul
// error "Could not reach Cloud Firestore backend". Long-polling otomatis
// mendeteksi kondisi ini dan beralih ke mode yang lebih tahan terhadap
// jaringan pembatas seperti itu.
// initializeFirestore hanya boleh dipanggil sekali per app — try/catch di
// sini menangani reload/HMR saat development, jatuh ke getFirestore biasa
// kalau instance Firestore untuk app ini sudah pernah dibuat sebelumnya.
// Cache lokal (IndexedDB) — dasar dukungan offline: baca & tulis tetap
// berfungsi tanpa koneksi (Firestore antre perubahan secara otomatis),
// lalu tersinkron sendiri begitu online kembali. Hanya diaktifkan di
// browser karena IndexedDB tidak ada saat build/prerender di Node.js.
// persistentSingleTabManager dipakai karena app ini tidak butuh sinkron
// antar-tab; kalau tab lain dibuka, tab itu otomatis jatuh ke cache
// memori biasa (fallback bawaan SDK, bukan error).
export const db = (() => {
  try {
    return initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      ...(typeof window !== "undefined"
        ? { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }) }
        : {}),
    });
  } catch {
    return getFirestore(app);
  }
})();

export const storage = getStorage(app);
