'use client';

import React from 'react';
import { Package } from 'lucide-react';
import InventoryPage from '@/src/components/inventory/InventoryPage';
import HomeroomGuard from '@/src/components/ui/HomeroomGuard';

export default function InventarisPage() {
  return (
    <div className="min-h-screen bg-nb-workspace p-4 sm:p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-nb-ink">Inventaris Kelas</h1>
          <p className="text-xs text-nb-ink-muted">Catat barang inventaris dan kondisinya</p>
        </div>
        <HomeroomGuard featureName="Inventaris Kelas" icon={Package}>
          <InventoryPage />
        </HomeroomGuard>
      </div>
    </div>
  );
}
