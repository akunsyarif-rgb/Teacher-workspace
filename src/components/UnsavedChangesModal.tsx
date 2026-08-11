'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';

type UnsavedChangesModalProps = {
  isOpen: boolean;
  onCancel: () => void;
  onLeaveWithoutSaving: () => void;
  // Jurnal: langsung menyimpan lalu lanjut keluar. Nilai: TIDAK langsung
  // menyimpan (melanggar "Proteksi Tinggi") — membuka modal Review dulu;
  // navigasi keluar baru lanjut setelah guru benar-benar konfirmasi di
  // sana (lihat handleGradesSaved di AttendanceForm.tsx), bukan langsung
  // saat tombol ini ditekan.
  primaryAction: { label: string; onClick: () => void | Promise<void> };
};

// Dialog generik "Simpan & Keluar / Keluar Tanpa Simpan / Batal" dari spec
// "Workflow Mengajar — Rencana Lanjutan" #6. Dipakai AttendanceForm saat
// guru mencoba pindah tab/kelas/Beranda selagi Jurnal atau Nilai punya
// perubahan yang belum tersimpan.
export default function UnsavedChangesModal({
  isOpen,
  onCancel,
  onLeaveWithoutSaving,
  primaryAction,
}: UnsavedChangesModalProps) {
  const [busy, setBusy] = useState(false);

  async function handlePrimary() {
    setBusy(true);
    try {
      await primaryAction.onClick();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Ada Perubahan Belum Tersimpan">
      <div className="space-y-4">
        <p className="text-xs text-gray-500 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          Kamu punya perubahan yang belum tersimpan. Simpan dulu sebelum keluar, atau lanjutkan tanpa menyimpan?
        </p>
        <div className="flex flex-col gap-2">
          <Button onClick={handlePrimary} loading={busy}>
            <span>{busy ? 'Menyimpan...' : primaryAction.label}</span>
          </Button>
          <button
            type="button"
            onClick={onLeaveWithoutSaving}
            disabled={busy}
            className="w-full py-3 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 rounded-2xl text-xs font-bold transition-colors"
          >
            Keluar Tanpa Simpan
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="w-full py-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600 rounded-2xl text-xs font-bold transition-colors"
          >
            Batal
          </button>
        </div>
      </div>
    </Modal>
  );
}
