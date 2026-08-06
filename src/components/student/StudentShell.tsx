'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import { useStudentAuth, StudentProfile } from '@/src/context/StudentAuthContext';
import StudentBottomNav from './StudentBottomNav';

type StudentShellProps = {
  title: string;
  subtitle?: string;
  children: (profile: StudentProfile) => React.ReactNode;
};

// Semua halaman Student Companion punya kebutuhan yang sama: tunggu sesi,
// tendang ke /student/login kalau belum klaim kode akses, lalu render isi
// dengan profil yang sudah pasti ada. Dikumpulkan di sini supaya tiap
// halaman tinggal fokus ke isinya.
export default function StudentShell({ title, subtitle, children }: StudentShellProps) {
  const { profile, loading } = useStudentAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !profile) {
      router.push('/student/login');
    }
  }, [loading, profile, router]);

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center animate-pulse shadow-lg shadow-blue-200">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        <p className="text-xs font-bold text-gray-500 tracking-wide">Memuat...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-5 pb-24">
      <div className="max-w-md mx-auto space-y-5">
        <div>
          <h1 className="text-lg font-extrabold text-gray-900">{title}</h1>
          <p className="text-xs text-gray-500">{subtitle || `Kelas ${profile.className}`}</p>
        </div>
        {children(profile)}
      </div>
      <StudentBottomNav />
    </div>
  );
}
