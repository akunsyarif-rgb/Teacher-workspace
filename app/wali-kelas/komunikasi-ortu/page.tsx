'use client';

import React from 'react';
import { Phone } from 'lucide-react';
import StudentNoteList from '@/src/components/studentnotes/StudentNoteList';
import HomeroomGuard from '@/src/components/ui/HomeroomGuard';
import { STUDENT_NOTE_CATEGORIES } from '@/lib/config/constants';

export default function KomunikasiOrtuPage() {
  return (
    <div className="min-h-screen bg-nb-workspace p-4 sm:p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-nb-ink">Komunikasi Orang Tua</h1>
          <p className="text-xs text-nb-ink-muted">Catat komunikasi dengan orang tua/wali siswa</p>
        </div>
        <HomeroomGuard featureName="Komunikasi Orang Tua" icon={Phone}>
          <StudentNoteList
            category={STUDENT_NOTE_CATEGORIES.KOMUNIKASI_ORTU}
            titleLabel="Ringkasan Komunikasi"
            titlePlaceholder="Contoh: Telepon terkait keterlambatan"
            emptyMessage="Belum ada catatan komunikasi untuk kelas ini."
            successMessage="Catatan komunikasi berhasil disimpan!"
          />
        </HomeroomGuard>
      </div>
    </div>
  );
}
