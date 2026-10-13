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
    <div className="p-4 bg-nb-green-soft border border-nb-rule rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-start gap-2">
        <ArrowRightLeft className="w-4 h-4 text-nb-green shrink-0 mt-0.5" />
        <p className="text-xs font-bold text-nb-green-strong">
          Ada {pendingCount} prestasi lama yang belum bisa dilihat siswa. Pindahkan sekali saja — catatan
          aslinya tidak dihapus.
        </p>
      </div>
      <button
        onClick={handleMigrate}
        disabled={migrating}
        className="px-4 py-2 bg-nb-green hover:bg-nb-green-strong disabled:bg-[#DDE3D8] disabled:text-[#5D665E] text-white rounded-xl text-xs font-bold transition-colors shadow-sm shrink-0"
      >
        {migrating ? 'Memindahkan...' : 'Pindahkan'}
      </button>
    </div>
  );
}
