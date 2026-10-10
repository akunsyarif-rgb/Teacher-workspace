'use client';

import { useState } from 'react';
import { auth } from '@/src/config/firebase';
import { signInAnonymously } from 'firebase/auth';
import { runSupabaseDiagnostics, type DiagResult } from '@/lib/diagnostics/supabaseCheck';

// Halaman uji (tanpa tautan menu): memeriksa jalur Firebase → Supabase untuk sesi yang sedang aktif. Hanya BACA; token tidak ditampilkan.
// Guru: masuk seperti biasa lalu buka halaman ini. Siswa anonim: buka di TAB PRIVAT, tekan "Uji sebagai siswa anonim".
export default function CekSupabasePage() {
  const [results, setResults] = useState<DiagResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [anonCreated, setAnonCreated] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setResults(await runSupabaseDiagnostics({
        getUser: () => auth.currentUser,
        env: { url: process.env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      }));
    } finally {
      setBusy(false);
    }
  }

  async function runAnonymous() {
    setBusy(true);
    try {
      if (!auth.currentUser) {
        await signInAnonymously(auth);
        setAnonCreated(true);
      }
    } finally {
      setBusy(false);
    }
    await run();
  }

  async function cleanup() {
    if (auth.currentUser?.isAnonymous) {
      await auth.currentUser.delete().catch(() => auth.signOut());
    }
    setAnonCreated(false);
    setResults(null);
  }

  const icon = (s: DiagResult['status']) => (s === 'pass' ? '✅' : s === 'fail' ? '❌' : 'ℹ️');
  return (
    <main className="mx-auto max-w-xl p-4 text-gray-900">
      <h1 className="text-lg font-bold">Uji Koneksi Supabase</h1>
      <p className="mt-1 text-sm text-gray-600">
        Hanya membaca; tidak mengubah data sekolah. Token tidak ditampilkan. Guru: masuk dulu seperti biasa. Siswa: buka halaman ini di tab privat.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={busy} onClick={run} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Uji sesi saya
        </button>
        <button disabled={busy} onClick={runAnonymous} className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Uji sebagai siswa anonim
        </button>
        {anonCreated && (
          <button disabled={busy} onClick={cleanup} className="rounded-lg border border-gray-400 px-4 py-2 text-sm font-semibold">
            Hapus akun uji
          </button>
        )}
      </div>
      {busy && <p className="mt-3 text-sm">Memeriksa…</p>}
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
