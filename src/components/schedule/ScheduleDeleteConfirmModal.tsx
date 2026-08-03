'use client';

import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

type ScheduleDeleteConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export default function ScheduleDeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
}: ScheduleDeleteConfirmModalProps) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Hapus Jadwal Ini?">
      <p className="text-xs text-gray-500">Jadwal yang dihapus tidak bisa dikembalikan.</p>
      <div className="flex gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button type="button" onClick={handleConfirm} loading={loading}>
          {loading ? 'Menghapus...' : 'Ya, Hapus'}
        </Button>
      </div>
    </Modal>
  );
}
