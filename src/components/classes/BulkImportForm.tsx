'use client';

import React, { useState } from 'react';
import { Users, Plus } from 'lucide-react';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import Button from '../ui/Button';
import * as classController from '@/lib/controllers/classController';

type BulkImportFormProps = {
  onAdded: () => void;
};

export default function BulkImportForm({ onAdded }: BulkImportFormProps) {
  const { workspaceId } = useWorkspace();
  const [className, setClassName] = useState('');
  const [namesText, setNamesText] = useState('');
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
      const result = await classController.submitBulkStudents(workspaceId, className, namesText);
      alert(`✅ Berhasil menambahkan ${result.savedCount} siswa ke kelas ${result.targetClass}!`);
      setClassName('');
      setNamesText('');
      onAdded();
    } catch (error: any) {
      setError(error.message || 'Gagal mengimpor siswa.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-4 flex flex-col justify-between">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-extrabold text-gray-900 uppercase tracking-wider">Impor Banyak Siswa</h3>
          </div>
          <span className="text-[10px] font-bold text-gray-400">1 Baris = 1 Nama</span>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            label="Nama Kelas Tujuan"
            value={className}
            onChange={setClassName}
            placeholder="Contoh: XI F TEKNIK 2"
            required
          />
          <Textarea
            label="Daftar Nama Siswa"
            value={namesText}
            onChange={setNamesText}
            placeholder="Tempel daftar nama siswa di sini (baris baru per nama)..."
            rows={4}
          />

          <Button type="submit" loading={loading}>
            <Plus className="w-4 h-4" />
            <span>{loading ? 'Menyimpan...' : 'Simpan Semua Sekaligus'}</span>
          </Button>
        </form>
      </div>
    </Card>
  );
}
