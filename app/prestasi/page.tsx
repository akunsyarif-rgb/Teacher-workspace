'use client';

import React from 'react';
import { Trophy } from 'lucide-react';
import StudentNoteList from '@/src/components/studentnotes/StudentNoteList';
import HomeroomGuard from '@/src/components/ui/HomeroomGuard';
import { STUDENT_NOTE_CATEGORIES } from '@/lib/config/constants';

export default function PrestasiPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Prestasi Siswa</h1>
          <p className="text-xs text-gray-500">Catat pencapaian dan prestasi siswa di kelas</p>
        </div>
        <HomeroomGuard featureName="Prestasi Siswa" icon={Trophy}>
          <StudentNoteList
            category={STUDENT_NOTE_CATEGORIES.PRESTASI}
            titleLabel="Nama Prestasi"
            titlePlaceholder="Contoh: Juara 1 Lomba Debat Tingkat Provinsi"
            emptyMessage="Belum ada prestasi tercatat untuk kelas ini."
            successMessage="Prestasi berhasil disimpan!"
          />
        </HomeroomGuard>
      </div>
    </div>
  );
}
