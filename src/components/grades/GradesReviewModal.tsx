'use client';

import React, { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

export type GradeChange = {
  studentName: string;
  columnTitle: string;
  oldValue: string;
  newValue: string;
};

type GradesReviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  changes: GradeChange[];
};

// Langkah "Review -> Simpan Nilai -> Konfirmasi" dari spec digabung jadi
// satu modal: isinya ADALAH review-nya (daftar perubahan), tombol di
// dalamnya ADALAH konfirmasi eksplisit sebelum nilai benar-benar tertulis
// & terkunci — sengaja tidak langsung menyimpan begitu guru menekan tombol
// "Simpan" utama di GradesTab, persis prinsip "Nilai tidak boleh otomatis
// tersimpan setiap kali mengetik" diperluas ke "juga tidak boleh tersimpan
// tanpa guru benar-benar melihat apa yang akan disimpan".
export default function GradesReviewModal({ isOpen, onClose, onConfirm, changes }: GradesReviewModalProps) {
  const [saving, setSaving] = useState(false);
  const hasCorrections = changes.some((c) => c.oldValue !== '');

  async function handleConfirm() {
    setSaving(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={hasCorrections ? 'Ubah Nilai?' : 'Simpan Nilai?'}>
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          {hasCorrections
            ? `${changes.length} nilai yang sudah terkunci 🔒 akan diubah. Periksa sekali lagi sebelum konfirmasi.`
            : `${changes.length} nilai akan disimpan dan terkunci 🔒. Periksa sekali lagi sebelum konfirmasi — nilai yang sudah terkunci tetap bisa dikoreksi nanti lewat tombol Edit.`}
        </p>

        <div className="max-h-64 overflow-y-auto space-y-2 -mx-1 px-1">
          {changes.map((change, idx) => (
            <div
              key={idx}
              className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0">
                <p className="font-bold text-gray-900 truncate">{change.studentName}</p>
                <p className="text-gray-400">
                  {change.columnTitle} {change.oldValue ? 'akan diubah' : 'akan disimpan'}:
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 font-extrabold">
                {change.oldValue && (
                  <>
                    <span className="text-gray-400">{change.oldValue}</span>
                    <ArrowRight className="w-3 h-3 text-gray-300" />
                  </>
                )}
                <span className="text-blue-600">{change.newValue || '-'}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-xl text-xs font-bold transition-colors"
          >
            Batal
          </button>
          <div className="flex-1">
            <Button onClick={handleConfirm} loading={saving}>
              <Lock className="w-4 h-4" />
              <span>{saving ? 'Menyimpan...' : hasCorrections ? 'Ubah Nilai' : 'Simpan Nilai'}</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
