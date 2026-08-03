'use client';

import React, { useState, useEffect } from 'react';
import { User as UserIcon, CheckCircle2 } from 'lucide-react';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as classController from '@/lib/controllers/classController';
import * as teacherProfileController from '@/lib/controllers/teacherProfileController';

export default function ProfileForm() {
  const { user, workspaceId, teacherProfile, refreshProfile } = useWorkspace();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [homeroomClassName, setHomeroomClassName] = useState('');
  const [classesList, setClassesList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setName(teacherProfile?.name || '');
    setSubject(teacherProfile?.subject || '');
    setHomeroomClassName(teacherProfile?.homeroomClassName || '');
  }, [teacherProfile]);

  useEffect(() => {
    if (workspaceId) loadClasses();
  }, [workspaceId]);

  async function loadClasses() {
    if (!workspaceId) return;
    try {
      const summaries = await classController.fetchClassSummaries(workspaceId);
      setClassesList(summaries.map((s: any) => s.className));
    } catch (error) {
      console.error('Gagal memuat daftar kelas:', error);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setSuccess(false);
    try {
      await teacherProfileController.saveTeacherName(user.uid, name);
      await teacherProfileController.saveTeacherSubject(user.uid, subject);
      await teacherProfileController.saveTeacherHomeroomClass(user.uid, homeroomClassName || null);
      await refreshProfile();
      setSuccess(true);
    } catch (error: any) {
      alert(error.message || 'Gagal menyimpan profil.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <UserIcon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Profil Guru</h2>
          <p className="text-xs text-gray-500">Kelola data diri dan penugasan wali kelas</p>
        </div>
      </div>

      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Profil berhasil disimpan!</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Nama Lengkap" value={name} onChange={setName} required />
        <Input
          label="Mata Pelajaran Utama"
          value={subject}
          onChange={setSubject}
          placeholder="Contoh: Pendidikan Agama Islam"
          required
        />

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">Wali Kelas Dari</label>
          <select
            value={homeroomClassName}
            onChange={(e) => setHomeroomClassName(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Bukan Wali Kelas</option>
            {classesList.map((cls) => (
              <option key={cls} value={cls}>
                Kelas {cls}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400 mt-1">
            Menentukan akses ke fitur khusus wali kelas (Kas Kelas, dan lainnya di kemudian hari).
          </p>
        </div>

        <Button type="submit" loading={loading}>
          {loading ? 'Menyimpan...' : 'Simpan Profil'}
        </Button>
      </form>
    </Card>
  );
}
