'use client';

import React, { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { SESSION_SKIP_REASONS } from '@/lib/config/constants';

const REASON_OPTIONS = Object.values(SESSION_SKIP_REASONS);

type SkipReasonModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string, note: string) => Promise<void>;
  className: string;
  timeSlot: string;
  initialReason?: string | null;
  initialNote?: string;
};

// Modal "guru mencatat alasan" dari "Penyesuaian Workflow Jadwal — Final"
// #3 — SENGAJA tidak menyentuh presensi/jurnal sama sekali. Ini murni
// konfirmasi/konteks kenapa sesi terlewat, bukan pengganti kewajiban
// presensi/jurnal (lihat "Prinsip utama": data presensi/jurnal = penentu
// penyelesaian).
export default function SkipReasonModal({
  isOpen,
  onClose,
  onConfirm,
  className,
  timeSlot,
  initialReason,
  initialNote,
}: SkipReasonModalProps) {
  const [reason, setReason] = useState<string>(initialReason || '');
  const [note, setNote] = useState(initialNote || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setReason(initialReason || '');
      setNote(initialNote || '');
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const isLainnya = reason === SESSION_SKIP_REASONS.LAINNYA;

  async function handleConfirm() {
    if (!reason) {
      setError('Pilih salah satu alasan.');
      return;
    }
    if (isLainnya && !note.trim()) {
      setError('Keterangan wajib diisi untuk alasan "Lainnya".');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onConfirm(reason, note);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan konfirmasi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Konfirmasi Sesi Terlewat">
      <div className="space-y-4">
        <p className="text-xs text-nb-ink-muted">
          Kelas {className} • {timeSlot} sudah lewat tanpa presensi/jurnal. Ini bukan kesalahan otomatis — catat
          alasannya kalau memang tidak sempat mengajar.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {REASON_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setReason(option)}
              className={`px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-colors border ${
                reason === option
                  ? 'bg-nb-green-soft border-nb-green/40 text-nb-green-strong'
                  : 'bg-nb-workspace border-nb-rule text-nb-ink-muted hover:bg-gray-100'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div>
          <label className="text-xs font-bold text-nb-ink block mb-1">
            Keterangan {isLainnya ? '(wajib)' : '(opsional)'}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={isLainnya ? 'Jelaskan alasannya...' : 'Catatan tambahan (opsional)'}
            className="w-full p-3 bg-nb-paper border border-nb-control rounded-xl text-xs text-nb-ink outline-none focus:bg-nb-paper focus:ring-2 focus:ring-nb-green"
          />
        </div>

        {error && <p className="text-xs font-bold text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-nb-ink rounded-xl text-xs font-bold transition-colors"
          >
            Batal
          </button>
          <div className="flex-1">
            <Button onClick={handleConfirm} loading={saving}>
              {saving ? 'Menyimpan...' : 'Simpan Konfirmasi'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
