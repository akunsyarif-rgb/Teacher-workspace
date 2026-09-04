'use client';

import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';

type GradeColumnModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (title: string, type: string) => Promise<void>;
};

export default function GradeColumnModal({ isOpen, onClose, onSubmit }: GradeColumnModalProps) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('Tugas');
  // Tanpa guard ini, dobel-tap "Tambahkan Kolom" (umum di layar sentuh
  // tablet) memicu dua kali onSubmit sebelum modal sempat tertutup —
  // membuat dua kolom nilai dengan judul sama persis.
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(title, type);
      setTitle('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tambah Kolom Penilaian Baru">
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Nama / Judul Materi"
          value={title}
          onChange={setTitle}
          placeholder="Contoh: Berpikir Kritis, Bab 1"
          required
        />

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">Kategori Penilaian</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="Tugas">Tugas</option>
            <option value="UH">UH (Ulangan Harian)</option>
            <option value="Praktek">Praktek</option>
            <option value="UAS">UAS / UTS</option>
          </select>
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Menambahkan...' : 'Tambahkan Kolom'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
