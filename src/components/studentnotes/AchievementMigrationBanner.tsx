'use client';

import React, { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as achievementController from '@/lib/controllers/achievementController';

/**
 * Prestasi yang tercatat sebelum pemisahan koleksi masih ada di
 * student_notes dan belum bisa dilihat siswa. Banner ini hanya muncul
 * kalau memang ada yang belum disalin, lalu hilang sendiri setelah
 * selesai — tidak menambah menu permanen untuk pekerjaan sekali jalan.
 */
export default function AchievementMigrationBanner({ onMigrated }: { onMigrated: () => void }) {
  const { workspaceId, teacherProfile } = useWorkspace();
  const className = teacherProfile?.homeroomClassName || '';
  const [pendingCount, setPendingCount] = useState(0);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    if (!workspaceId || !className) return;
    (async () => {
      try {
        const count = await achievementController.countUnmigratedAchievements(workspaceId, className);
        setPendingCount(count);
      } catch (error) {
        console.error('Gagal memeriksa prestasi lama:', error);
      }
    })();
  }, [workspaceId, className]);

  async function handleMigrate() {
    if (!workspaceId || !className) return;
    setMigrating(true);
    try {
      const moved = await achievementController.migrateLegacyAchievements(workspaceId, className);
      setPendingCount(0);
      onMigrated();
      alert(`${moved} prestasi lama berhasil dipindahkan dan kini bisa dilihat siswa.`);
    } catch (error: any) {
      alert(error.message || 'Gagal memindahkan prestasi lama.');
    } finally {
      setMigrating(false);
    }
  }

  if (pendingCount === 0) return null;

  return (
    <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-start gap-2">
        <ArrowRightLeft className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <p className="text-[11px] font-bold text-blue-800">
          Ada {pendingCount} prestasi lama yang belum bisa dilihat siswa. Pindahkan sekali saja — catatan
          aslinya tidak dihapus.
        </p>
      </div>
      <button
        onClick={handleMigrate}
        disabled={migrating}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-[11px] font-bold transition-colors shadow-sm shrink-0"
      >
        {migrating ? 'Memindahkan...' : 'Pindahkan'}
      </button>
    </div>
  );
}
