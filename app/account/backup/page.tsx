'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, HardDriveDownload } from 'lucide-react';
import WorkspaceGuard from '@/src/components/ui/WorkspaceGuard';
import BackupPanel from '@/src/components/backup/BackupPanel';

export default function BackupPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/account" aria-label="Kembali ke Akun" className="p-2.5 -ml-2 rounded-xl hover:bg-gray-100">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200">
            <HardDriveDownload className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Backup & Ekspor Data</h1>
            <p className="text-xs text-gray-500">Unduh cadangan data Anda kapan saja</p>
          </div>
        </div>
        <WorkspaceGuard>
          <BackupPanel />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
