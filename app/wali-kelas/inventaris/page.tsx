'use client';

import React from 'react';
import { Package } from 'lucide-react';
import InventoryPage from '@/src/components/inventory/InventoryPage';
import HomeroomGuard from '@/src/components/ui/HomeroomGuard';

export default function InventarisPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Inventaris Kelas</h1>
          <p className="text-xs text-gray-500">Catat barang inventaris dan kondisinya</p>
        </div>
        <HomeroomGuard featureName="Inventaris Kelas" icon={Package}>
          <InventoryPage />
        </HomeroomGuard>
      </div>
    </div>
  );
}
