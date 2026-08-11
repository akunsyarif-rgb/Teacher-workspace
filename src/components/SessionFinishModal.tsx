'use client';

import React from 'react';
import { CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';

type SessionFinishModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onGoHome: () => void;
  className: string;
  hasAttendance: boolean;
  hasJournal: boolean;
  gradesDraftCount: number;
};

// Ringkasan "Selesai Mengajar" dari spec #5 — SENGAJA tidak menulis apa pun
// ke Firestore dan tidak mengunci apa pun. isDone tetap dihitung otomatis
// dari hasAttendance && hasJournal (lib/services/dashboardService.ts);
// modal ini murni menampilkan status itu + peringatan draft nilai kalau
// ada, supaya guru sadar sebelum pindah ke Beranda — tapi tetap bebas
// kembali memperbaiki kapan saja.
export default function SessionFinishModal({
  isOpen,
  onClose,
  onGoHome,
  className,
  hasAttendance,
  hasJournal,
  gradesDraftCount,
}: SessionFinishModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Selesai Mengajar?">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Ringkasan sesi Kelas {className} hari ini. Data tidak dikunci — kamu tetap bisa kembali memperbaiki kapan
          saja.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
            <span className="text-xs font-bold text-gray-700">Presensi</span>
            <span className={`flex items-center gap-1.5 text-xs font-bold ${hasAttendance ? 'text-emerald-600' : 'text-gray-400'}`}>
              {hasAttendance ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
              {hasAttendance ? 'Tersimpan' : 'Belum diisi'}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
            <span className="text-xs font-bold text-gray-700">Jurnal</span>
            <span className={`flex items-center gap-1.5 text-xs font-bold ${hasJournal ? 'text-emerald-600' : 'text-gray-400'}`}>
              {hasJournal ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
              {hasJournal ? 'Tersimpan' : 'Belum diisi'}
            </span>
          </div>
          {gradesDraftCount > 0 && (
            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl">
              <span className="text-xs font-bold text-amber-700">Nilai</span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
                <AlertTriangle className="w-4 h-4" />
                {gradesDraftCount} draft belum disimpan
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-colors"
          >
            Lanjutkan Mengajar
          </button>
          <div className="flex-1">
            <Button onClick={onGoHome}>Kembali ke Beranda</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
