'use client';

import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';

type AssignmentFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { title: string; description: string; dueDate: string }) => Promise<void>;
};

export default function AssignmentFormModal({ isOpen, onClose, onSubmit }: AssignmentFormModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ title, description, dueDate });
      setTitle('');
      setDescription('');
      setDueDate('');
      onClose();
    } catch (error: any) {
      alert(error.message || 'Gagal membuat tugas.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Buat Tugas Baru">
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Judul Tugas"
          value={title}
          onChange={setTitle}
          placeholder="Contoh: Latihan Soal Bab 3"
          required
        />

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">Instruksi (opsional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Jelaskan apa yang harus dikerjakan siswa"
            rows={3}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <Input label="Tenggat Waktu" type="date" value={dueDate} onChange={setDueDate} required />

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" loading={saving}>
            {saving ? 'Menyimpan...' : 'Buat Tugas'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
