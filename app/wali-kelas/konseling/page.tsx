'use client';

import React from 'react';
import { HeartHandshake } from 'lucide-react';
import StudentNoteList from '@/src/components/studentnotes/StudentNoteList';
import HomeroomGuard from '@/src/components/ui/HomeroomGuard';
import { STUDENT_NOTE_CATEGORIES } from '@/lib/config/constants';

export default function KonselingPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Catatan Konseling</h1>
          <p className="text-xs text-gray-500">Catat sesi konseling dan tindak lanjut siswa</p>
        </div>
        <HomeroomGuard featureName="Konseling" icon={HeartHandshake}>
          <StudentNoteList
            category={STUDENT_NOTE_CATEGORIES.KONSELING}
            titleLabel="Topik/Perihal"
            titlePlaceholder="Contoh: Konsultasi kesulitan belajar"
            emptyMessage="Belum ada catatan konseling untuk kelas ini."
            successMessage="Catatan konseling berhasil disimpan!"
          />
        </HomeroomGuard>
      </div>
    </div>
  );
}
