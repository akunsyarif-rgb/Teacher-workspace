'use client';

import React from 'react';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import LoadingSpinner from './LoadingSpinner';

type WorkspaceGuardProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export default function WorkspaceGuard({ children, fallback }: WorkspaceGuardProps) {
  const { workspaceId, loading } = useWorkspace();

  if (loading) {
    return <LoadingSpinner text="Memuat workspace..." />;
  }

  if (!workspaceId) {
    return (
      fallback || (
        <div className="bg-nb-paper p-8 rounded-3xl shadow-sm border border-nb-rule text-center space-y-3">
          <div className="w-16 h-16 mx-auto bg-amber-50 rounded-full flex items-center justify-center">
            <span className="text-3xl">🏫</span>
          </div>
          <h3 className="text-sm font-extrabold text-nb-ink">Belum Ada Workspace</h3>
          <p className="text-xs text-nb-ink-muted max-w-sm mx-auto">
            Anda belum terdaftar dalam workspace. Silakan hubungi admin sekolah atau buat workspace baru.
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="mt-2 px-4 py-2 bg-nb-green text-white rounded-xl text-xs font-bold hover:bg-nb-green-strong transition-colors"
          >
            Kembali ke Beranda
          </button>
        </div>
      )
    );
  }

  return <>{children}</>;
}
