'use client';

import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import Modal from '@/src/components/ui/Modal';
import Button from '@/src/components/ui/Button';

type MarkCompletedConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  loading: boolean;
};

// Konfirmasi sebelum "Tandai Presensi Selesai" — SENGAJA menegaskan bahwa
// ini murni penanda progres, bukan mengunci data: presensi tetap bisa
// dikoreksi kapan saja sesudahnya (lihat komentar `completed` di
// AttendanceTab). Kalimat yang menyiratkan "tidak bisa diubah lagi" akan
// membuat guru ragu menekan tombol padahal sebenarnya aman.
export default function MarkCompletedConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  loading,
}: MarkCompletedConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tandai Presensi Selesai?">
      <div className="space-y-4">
        <div className="p-3.5 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800">
            Presensi akan ditandai selesai. Ini murni penanda progres — status masih bisa dikoreksi kapan saja
            setelah ini kalau ada kesalahan.
          </p>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-xl text-xs font-bold transition-colors"
          >
            Batal
          </button>
          <div className="flex-1">
            <Button onClick={onConfirm} loading={loading}>
              {loading ? 'Menandai...' : 'Ya, Tandai Selesai'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
