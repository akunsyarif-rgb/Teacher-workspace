'use client';

import React from 'react';
import Link from 'next/link';
import { Wallet } from 'lucide-react';
import ClassFundPage from '@/src/components/classfund/ClassFundPage';
import WorkspaceGuard from '@/src/components/ui/WorkspaceGuard';
import { useWorkspace } from '@/src/context/WorkspaceContext';

function NotHomeroomTeacher() {
  return (
    <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 text-center space-y-3">
      <div className="w-16 h-16 mx-auto bg-blue-50 rounded-full flex items-center justify-center">
        <Wallet className="w-7 h-7 text-blue-600" />
      </div>
      <h3 className="text-sm font-extrabold text-gray-700">Khusus Wali Kelas</h3>
      <p className="text-xs text-gray-500 max-w-sm mx-auto">
        Fitur Kas Kelas hanya tersedia untuk guru yang menjadi wali kelas. Atur penugasan wali
        kelas di halaman Profil.
      </p>
      <Link
        href="/profile"
        className="inline-block mt-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors"
      >
        Buka Halaman Profil
      </Link>
    </div>
  );
}

export default function KasKelasPage() {
  const { teacherProfile } = useWorkspace();

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Kas Kelas</h1>
          <p className="text-xs text-gray-500">Catat pemasukan dan pengeluaran kas kelas</p>
        </div>
        <WorkspaceGuard>
          {teacherProfile?.homeroomClassName ? <ClassFundPage /> : <NotHomeroomTeacher />}
        </WorkspaceGuard>
      </div>
    </div>
  );
}
