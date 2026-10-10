'use client';

import { useState } from 'react';
import { auth } from '@/src/config/firebase';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, signInAnonymously, type Auth } from 'firebase/auth';
import { runSupabaseDiagnostics, type DiagResult } from '@/lib/diagnostics/supabaseCheck';

// Halaman uji (tanpa tautan menu): memeriksa jalur Firebase → Supabase untuk sesi yang sedang aktif. Hanya BACA; token tidak ditampilkan.
// Guru: masuk seperti biasa lalu buka halaman ini. Siswa anonim: buka di TAB PRIVAT, tekan "Uji sebagai siswa anonim".
export default function CekSupabasePage() {
  const [results, setResults] = useState<DiagResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState('');

  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };

  // Uji sesi yang sedang aktif (guru, atau siswa yang sedang masuk). Menunggu Firebase selesai memulihkan sesi dulu.
  async function run() {
    setBusy(true);
    setWho('Sesi yang sedang aktif di tab ini');
    try {
      await auth.authStateReady();
      setResults(await runSupabaseDiagnostics({ getUser: () => auth.currentUser, env }));
    } finally {
      setBusy(false);
    }
  }

  // Siswa anonim: dibuat di aplikasi Firebase TERPISAH dengan penyimpanan memori, jadi tidak pernah memakai/mengganti sesi guru
  // di tab ini (tidak perlu tab privat). Akun uji dihapus otomatis setelah selesai.
  async function runAnonymous() {
    setBusy(true);
    setWho('Siswa anonim BARU (sesi terpisah dari akun guru Anda)');
    let app: FirebaseApp | null = null;
    let anonAuth: Auth | null = null;
    try {
      app = initializeApp(auth.app.options, `uji-anonim-${Date.now()}`);
      anonAuth = initializeAuth(app, { persistence: inMemoryPersistence });
      await signInAnonymously(anonAuth);
      const a = anonAuth;
      setResults(await runSupabaseDiagnostics({ getUser: () => a.currentUser, env }));
    } catch (e) {
      setResults([{ id: 'anon-start', label: 'Membuat akun uji siswa anonim', status: 'fail', detail: e instanceof Error ? e.message : String(e) }]);
    } finally {
      try { await anonAuth?.currentUser?.delete(); } catch { /* akun uji sementara; abaikan */ }
      if (app) await deleteApp(app).catch(() => {});
      setBusy(false);
    }
  }

  const icon = (s: DiagResult['status']) => (s === 'pass' ? '✅' : s === 'fail' ? '❌' : 'ℹ️');
  return (
    <main className="mx-auto max-w-xl p-4 text-gray-900">
      <h1 className="text-lg font-bold">Uji Koneksi Supabase</h1>
      <p className="mt-1 text-sm text-gray-600">
        Hanya membaca; tidak mengubah data sekolah. Token tidak ditampilkan. Guru: masuk dulu seperti biasa lalu tekan &quot;Uji sesi saya&quot;. Siswa: tekan &quot;Uji sebagai siswa anonim&quot; — akun uji dibuat terpisah dan dihapus otomatis, sesi guru Anda tidak tersentuh.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={busy} onClick={run} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Uji sesi saya
        </button>
        <button disabled={busy} onClick={runAnonymous} className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Uji sebagai siswa anonim
        </button>
      </div>
      {busy && <p className="mt-3 text-sm">Memeriksa…</p>}
      {who && !busy && results && <p className="mt-3 text-sm font-semibold">Diuji sebagai: {who}</p>}
      {results && (
        <ul className="mt-4 space-y-2">
          {results.map((r) => (
            <li key={r.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
              <div className="font-semibold">{icon(r.status)} {r.label}</div>
              <div className="mt-1 text-gray-700">{r.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
