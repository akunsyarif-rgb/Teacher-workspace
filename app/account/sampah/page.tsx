'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import WorkspaceGuard from '@/src/components/ui/WorkspaceGuard';
import RecycleBinPanel from '@/src/components/recyclebin/RecycleBinPanel';

export default function SampahPage() {
  return (
    <div className="min-h-screen bg-nb-workspace p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/account"
            className="p-2.5 -m-1.5 text-nb-ink-muted hover:text-nb-ink transition-colors"
            aria-label="Kembali"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-extrabold text-nb-ink">Sampah</h1>
            <p className="text-xs text-nb-ink-muted">Pulihkan siswa, kelas, tugas, dan kolom nilai yang terhapus</p>
          </div>
        </div>

        <WorkspaceGuard>
          <RecycleBinPanel />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
