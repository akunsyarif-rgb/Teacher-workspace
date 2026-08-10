'use client';

import React, { useState } from 'react';
import { Paperclip, FileText, X } from 'lucide-react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { validateUploadFile } from '@/lib/adapters/storageAdapter';

type AssignmentFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { title: string; description: string; dueDate: string; file: File | null }) => Promise<void>;
};

export default function AssignmentFormModal({ isOpen, onClose, onSubmit }: AssignmentFormModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    try {
      // Dicek di sini juga supaya guru tahu file-nya ditolak sebelum
      // menunggu unggahan besar selesai lalu gagal di Storage rules.
      validateUploadFile(picked);
      setFile(picked);
    } catch (error: any) {
      alert(error.message);
      e.target.value = '';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ title, description, dueDate, file });
      setTitle('');
      setDescription('');
      setDueDate('');
      setFile(null);
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

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">Materi Soal (opsional)</label>
          {file ? (
            <div className="flex items-center justify-between gap-2 p-2.5 bg-blue-50 rounded-xl">
              <span className="flex items-center gap-1.5 min-w-0">
                <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-[11px] font-bold text-blue-800 truncate">{file.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="p-1 text-blue-400 hover:text-red-500 transition-colors shrink-0"
                title="Hapus pilihan file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-1.5 p-2.5 border border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 transition-colors">
              <Paperclip className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-[11px] font-bold text-gray-500">Lampirkan foto / PDF / Word</span>
              <input
                type="file"
                accept="image/*,application/pdf,.doc,.docx"
                onChange={handlePickFile}
                className="hidden"
              />
            </label>
          )}
        </div>

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
