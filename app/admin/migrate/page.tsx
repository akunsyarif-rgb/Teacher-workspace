'use client';

import React, { useState } from 'react';
import { auth } from '@/src/config/firebase';
import { getDocuments, batchWrite, BatchOperation } from '@/lib/adapters/firestoreAdapter';
import { COLLECTIONS } from '@/lib/config/constants';
import { fetchTeacherProfileForSession, submitCreateIndividualWorkspace } from '@/lib/controllers/workspaceController';

const COLLECTIONS_TO_MIGRATE = [
  { key: 'STUDENTS', label: 'Siswa' },
  { key: 'JOURNALS', label: 'Jurnal' },
  { key: 'ATTENDANCES', label: 'Presensi' },
  { key: 'GRADES', label: 'Nilai' },
  { key: 'GRADE_COLUMNS', label: 'Kolom Nilai' },
  { key: 'SCHEDULES', label: 'Jadwal' },
] as const;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function MigrateWorkspacePage() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  function addLog(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function handleMigrate() {
    setRunning(true);
    setLog([]);

    const user = auth.currentUser;
    if (!user) {
      addLog('Belum login. Silakan login dulu, lalu buka halaman ini lagi.');
      setRunning(false);
      return;
    }

    try {
      const existingProfile = await fetchTeacherProfileForSession(user.uid);
      if (existingProfile?.workspaceId) {
        addLog(`Akun ini sudah punya Workspace (id: ${existingProfile.workspaceId}). Tidak ada yang perlu dimigrasi.`);
        setDone(true);
        setRunning(false);
        return;
      }

      addLog('Membuat Workspace baru...');
      const workspace = await submitCreateIndividualWorkspace(
        user.uid,
        'individual_lifetime',
        existingProfile?.name || user.email || 'Workspace Saya'
      );
      if (!workspace) throw new Error('Gagal membuat workspace.');
      addLog(`Workspace dibuat (id: ${workspace.id}).`);

      for (const col of COLLECTIONS_TO_MIGRATE) {
        const collectionName = COLLECTIONS[col.key];
        addLog(`Memindai koleksi "${col.label}"...`);

        const allDocs = await getDocuments(collectionName);
        const docsWithoutWorkspace = allDocs.filter((d: any) => !d.workspaceId);

        if (docsWithoutWorkspace.length === 0) {
          addLog(`  Tidak ada data lama di "${col.label}".`);
          continue;
        }

        const operations: BatchOperation[] = docsWithoutWorkspace.map((d: any) => ({
          type: 'set',
          collectionName,
          id: d.id,
          data: { workspaceId: workspace.id },
        }));

        for (const group of chunk(operations, 400)) {
          await batchWrite(group);
        }

        addLog(`  ${docsWithoutWorkspace.length} dokumen di "${col.label}" berhasil ditandai.`);
      }

      addLog('Migrasi selesai! Anda sekarang bisa memakai aplikasi seperti biasa.');
      setDone(true);
    } catch (err: any) {
      addLog(`Terjadi kesalahan: ${err?.message || String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-nb-workspace p-6 flex items-center justify-center">
      <div className="max-w-lg w-full bg-nb-paper p-6 rounded-3xl shadow-sm border border-nb-rule space-y-4">
        <h1 className="text-lg font-extrabold text-nb-ink">Migrasi Data ke Workspace</h1>
        <p className="text-xs text-nb-ink-muted">
          Halaman ini hanya dipakai SEKALI untuk memindahkan data lama Anda ke sistem Workspace baru.
        </p>

        <button
          onClick={handleMigrate}
          disabled={running || done}
          className="w-full py-3 bg-nb-green hover:bg-nb-green-strong disabled:opacity-50 text-white rounded-2xl text-xs font-bold"
        >
          {running ? 'Sedang migrasi...' : done ? 'Selesai' : 'Jalankan Migrasi'}
        </button>

        {log.length > 0 && (
          <div className="bg-nb-workspace rounded-xl p-3 space-y-1 max-h-96 overflow-y-auto">
            {log.map((line, i) => (
              <p key={i} className="text-xs font-mono text-nb-ink">
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
