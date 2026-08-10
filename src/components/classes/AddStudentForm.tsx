'use client';

import React, { useState } from 'react';
import { UserPlus, Plus } from 'lucide-react';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Button from '../ui/Button';
import * as classController from '@/lib/controllers/classController';

type AddStudentFormProps = {
  onAdded: () => void;
  // Dipakai dari ClassDetail: kelas sudah pasti (siswa ditambahkan ke kelas
  // yang sedang dibuka), jadi form tidak perlu menawarkan pilihan/mengetik
  // nama kelas — memisahkan alur "Tambah Siswa" dari "Tambah Kelas Baru"
  // (lihat ClassManagement, yang selalu memulai kelas baru dan tidak pernah
  // mengunci nama kelas).
  lockedClassName?: string;
};

export default function AddStudentForm({ onAdded, lockedClassName }: AddStudentFormProps) {
  const { workspaceId } = useWorkspace();
  const [name, setName] = useState('');
  const [nis, setNis] = useState('');
  const [className, setClassName] = useState(lockedClassName || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) {
      setError('Workspace tidak ditemukan. Silakan login ulang.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await classController.submitSingleStudent(workspaceId, { name, nis, className });
      setName('');
      setNis('');
      if (!lockedClassName) {
        setClassName('');
      }
      onAdded();
    } catch (error: any) {
      setError(error.message || 'Gagal menambah siswa.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-4 flex flex-col justify-between">
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <UserPlus className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-extrabold text-gray-900 uppercase tracking-wider">Tambah 1 Siswa</h3>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input label="Nama Lengkap Siswa" value={name} onChange={setName} required />
          <Input label="NIS (Opsional)" value={nis} onChange={setNis} />

          {lockedClassName ? (
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">Kelas</label>
              <p className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-extrabold text-gray-700">
                {lockedClassName}
              </p>
            </div>
          ) : (
            <Input
              label="Nama Kelas (Baru)"
              value={className}
              onChange={setClassName}
              placeholder="Contoh: XI F TEKNIK 2"
              required
            />
          )}

          <Button type="submit" loading={loading}>
            <Plus className="w-4 h-4" />
            <span>{loading ? 'Menyimpan...' : 'Simpan Siswa'}</span>
          </Button>
        </form>
      </div>
    </Card>
  );
}
