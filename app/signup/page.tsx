'use client';

import React, { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/src/config/firebase';
import { useRouter } from 'next/navigation';
import { GraduationCap, Lock, Mail, ArrowRight, User, Building2, KeyRound } from 'lucide-react';
import * as workspaceController from '@/lib/controllers/workspaceController';

type SignupMode = 'individual' | 'school' | 'join';

export default function SignupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<SignupMode>('individual');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const modes = [
    { key: 'individual', label: 'Individual', icon: User },
    { key: 'school', label: 'Sekolah', icon: Building2 },
    { key: 'join', label: 'Gabung', icon: KeyRound },
  ] as const;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Email dan kata sandi wajib diisi.');
      return;
    }
    if (password.length < 6) {
      setError('Kata sandi minimal 6 karakter.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    if (mode === 'individual' && !workspaceName.trim()) {
      setError('Nama Workspace wajib diisi.');
      return;
    }
    if (mode === 'school' && !workspaceName.trim()) {
      setError('Nama Sekolah wajib diisi.');
      return;
    }
    if (mode === 'join' && !inviteCode.trim()) {
      setError('Kode undangan wajib diisi.');
      return;
    }

    setLoading(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const uid = credential.user.uid;

      if (mode === 'individual') {
        await workspaceController.submitCreateIndividualWorkspace(
          uid,
          'individual_lifetime',
          workspaceName.trim()
        );
      } else if (mode === 'school') {
        await workspaceController.submitCreateSchoolWorkspace(uid, workspaceName.trim());
      } else {
        const idToken = await credential.user.getIdToken();
        await workspaceController.submitJoinWorkspaceByCode(idToken, inviteCode.trim());
      }

      router.push('/');
    } catch (err: any) {
      console.error('Gagal mendaftar:', err);
      if (err?.code === 'auth/email-already-in-use') {
        setError('Email ini sudah terdaftar. Silakan masuk lewat halaman login.');
      } else if (err?.code === 'auth/invalid-email') {
        setError('Format email tidak valid.');
      } else {
        setError(err.message || 'Gagal mendaftar. Silakan coba lagi.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-sm border border-gray-100 space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-md shadow-blue-200">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-extrabold text-gray-900 mt-2">Daftar Akun Guru</h1>
          <p className="text-xs text-gray-400">Buat Workspace baru atau gabung ke sekolah Anda</p>
        </div>

        <div className="flex bg-gray-100 p-1.5 rounded-2xl">
          {modes.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95 ${
                mode === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3.5 bg-red-50 border border-red-100 rounded-2xl text-xs font-bold text-red-600 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Email Akun</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              <input
                type="email"
                placeholder="nama@sekolah.sch.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-extrabold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Kata Sandi</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              <input
                type="password"
                placeholder="Minimal 6 karakter"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-extrabold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Konfirmasi Kata Sandi</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              <input
                type="password"
                placeholder="Ulangi kata sandi"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-extrabold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {(mode === 'individual' || mode === 'school') && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                {mode === 'individual' ? 'Nama Workspace' : 'Nama Sekolah'}
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  placeholder={mode === 'individual' ? 'Contoh: Kelas Pak Syarif' : 'Contoh: SMA Negeri 2 Tarakan'}
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-extrabold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          )}

          {mode === 'join' && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Kode Undangan</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  placeholder="Contoh: AB3D9F"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  required
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-extrabold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600 tracking-widest"
                />
              </div>
              <p className="text-[10px] text-gray-400 px-1">Minta kode ini ke admin sekolah Anda.</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold shadow-md shadow-blue-200 transition-all active:scale-[0.97] flex items-center justify-center gap-2 mt-2"
          >
            <span>{loading ? 'Memproses...' : 'Daftar & Masuk'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="text-center text-xs text-gray-400">
          Sudah punya akun?{' '}
          <a href="/login" className="text-blue-600 font-bold hover:underline">
            Masuk di sini
          </a>
        </p>
      </div>
    </div>
  );
}
