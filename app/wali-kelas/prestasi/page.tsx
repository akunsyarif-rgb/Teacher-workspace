'use client';

import React, { useState } from 'react';
import { Trophy } from 'lucide-react';
import StudentNoteList from '@/src/components/studentnotes/StudentNoteList';
import AchievementMigrationBanner from '@/src/components/studentnotes/AchievementMigrationBanner';
import HomeroomGuard from '@/src/components/ui/HomeroomGuard';
import { STUDENT_NOTE_CATEGORIES } from '@/lib/config/constants';
import * as achievementController from '@/lib/controllers/achievementController';

// Prestasi memakai koleksi student_achievements, bukan student_notes
// seperti Konseling/Komunikasi Ortu — supaya bisa dibuka ke siswa tanpa
// ikut membuka catatan konseling. Lihat firestore.rules.
const ACHIEVEMENT_SOURCE = {
  fetch: (workspaceId: string, className: string) =>
    achievementController.fetchAchievements(workspaceId, className),
  submit: (
    workspaceId: string,
    className: string,
    data: { studentId: string; studentName: string; title: string; notes: string }
  ) => achievementController.submitAchievement(workspaceId, className, data),
  remove: (id: string) => achievementController.deleteAchievement(id),
  cacheKey: (workspaceId: string, className: string) =>
    achievementController.achievementsCacheKey(workspaceId, className),
};

export default function PrestasiPage() {
  // Dipakai untuk memaksa daftar dimuat ulang setelah migrasi selesai.
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Prestasi Siswa</h1>
          <p className="text-xs text-gray-500">
            Catat pencapaian siswa — otomatis tampil di profil Student Companion mereka
          </p>
        </div>
        <HomeroomGuard featureName="Prestasi Siswa" icon={Trophy}>
          <AchievementMigrationBanner onMigrated={() => setReloadKey((key) => key + 1)} />
          <StudentNoteList
            key={reloadKey}
            category={STUDENT_NOTE_CATEGORIES.PRESTASI}
            titleLabel="Nama Prestasi"
            titlePlaceholder="Contoh: Juara 1 Lomba Debat Tingkat Provinsi"
            emptyMessage="Belum ada prestasi tercatat untuk kelas ini."
            successMessage="Prestasi berhasil disimpan!"
            dataSource={ACHIEVEMENT_SOURCE}
          />
        </HomeroomGuard>
      </div>
    </div>
  );
}
