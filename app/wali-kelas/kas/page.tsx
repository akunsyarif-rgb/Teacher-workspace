'use client';

import React from 'react';
import { Wallet } from 'lucide-react';
import ClassFundPage from '@/src/components/classfund/ClassFundPage';
import HomeroomGuard from '@/src/components/ui/HomeroomGuard';

export default function KasKelasPage() {
  return (
    <div className="min-h-screen bg-nb-workspace p-4 sm:p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-nb-ink">Kas Kelas</h1>
          <p className="text-xs text-nb-ink-muted">Catat pemasukan dan pengeluaran kas kelas</p>
        </div>
        <HomeroomGuard featureName="Kas Kelas" icon={Wallet}>
          <ClassFundPage />
        </HomeroomGuard>
      </div>
    </div>
  );
}
