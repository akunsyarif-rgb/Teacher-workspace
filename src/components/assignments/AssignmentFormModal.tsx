'use client';

import React, { useEffect, useState } from 'react';
import { Paperclip, FileText, X, ArrowLeft, Calendar, Cloud } from 'lucide-react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { validateUploadFile } from '@/lib/adapters/storageAdapter';
import { validateDriveUploadFile } from '@/lib/adapters/driveUploadAdapter';

export type MaterialFileProvider = 'firebase-storage' | 'google-drive';

type AssignmentFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    dueDate: string;
    file: File | null;
    fileProvider: MaterialFileProvider;
  }) => Promise<void>;
};

export default function AssignmentFormModal({ isOpen, onClose, onSubmit }: AssignmentFormModalProps) {
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  // Firebase Storage tetap default (10 MB, jalur utama & sudah teruji).
  // Google Drive opsi kedua — batasnya lebih kecil (4 MB) karena file
  // lewat server, lihat driveUploadAdapter.ts.
  const [fileProvider, setFileProvider] = useState<MaterialFileProvider>('firebase-storage');
  const [saving, setSaving] = useState(false);

  // Reset ke langkah form setiap modal dibuka lagi — supaya guru tidak
  // pernah terdampar di layar Preview tugas sebelumnya.
  useEffect(() => {
    if (isOpen) setStep('form');
  }, [isOpen]);

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    try {
      // Dicek di sini juga supaya guru tahu file-nya ditolak sebelum
      // menunggu unggahan besar selesai lalu gagal di Storage rules /
      // API upload Drive.
      if (fileProvider === 'google-drive') {
        validateDriveUploadFile(picked);
      } else {
        validateUploadFile(picked);
      }
      setFile(picked);
    } catch (error: any) {
      alert(error.message);
      e.target.value = '';
    }
  }

  function handleContinueToPreview(e: React.FormEvent) {
    e.preventDefault();
    setStep('preview');
  }

  async function handlePublish() {
    setSaving(true);
    try {
      await onSubmit({ title, description, dueDate, file, fileProvider });
      setTitle('');
      setDescription('');
      setDueDate('');
      setFile(null);
      setFileProvider('firebase-storage');
      setStep('form');
      onClose();
    } catch (error: any) {
      alert(error.message || 'Gagal membuat tugas.');
    } finally {
      setSaving(false);
    }
  }

  if (step === 'preview') {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Preview Tugas">
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Periksa sekali lagi sebelum Publish — begitu dipublish, tugas langsung tampil di Student Companion.
          </p>
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-2">
            <p className="text-sm font-extrabold text-gray-900">{title}</p>
            {description && <p className="text-xs text-gray-600 whitespace-pre-wrap">{description}</p>}
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
              <Calendar className="w-3.5 h-3.5" />
              Tenggat {dueDate}
            </p>
            {file && (
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-blue-700">
                <FileText className="w-3.5 h-3.5" />
                {file.name}
              </p>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setStep('form')}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-xl text-xs font-bold transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Kembali
            </button>
            <div className="flex-1">
              <Button onClick={handlePublish} loading={saving}>
                {saving ? 'Mempublish...' : 'Publish Tugas'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Buat Tugas Baru">
      <form onSubmit={handleContinueToPreview} className="space-y-3">
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

          {!file && (
            <div className="flex gap-1.5 mb-1.5">
              <button
                type="button"
                onClick={() => setFileProvider('firebase-storage')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                  fileProvider === 'firebase-storage'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                Firebase Storage (maks 10 MB)
              </button>
              <button
                type="button"
                onClick={() => setFileProvider('google-drive')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                  fileProvider === 'google-drive'
                    ? 'bg-teal-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                Google Drive (maks 4 MB)
              </button>
            </div>
          )}

          {file ? (
            <div
              className={`flex items-center justify-between gap-2 p-2.5 rounded-xl ${
                fileProvider === 'google-drive' ? 'bg-teal-50' : 'bg-blue-50'
              }`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                {fileProvider === 'google-drive' ? (
                  <Cloud className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                )}
                <span
                  className={`text-[11px] font-bold truncate ${
                    fileProvider === 'google-drive' ? 'text-teal-800' : 'text-blue-800'
                  }`}
                >
                  {file.name}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="p-1 text-blue-400 hover:text-red-500 transition-colors shrink-0"
                title="Hapus pilihan file"
                aria-label="Hapus pilihan file"
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
          <Button type="submit">Preview</Button>
        </div>
      </form>
    </Modal>
  );
}
