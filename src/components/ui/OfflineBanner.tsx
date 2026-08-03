'use client';

import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/src/hooks/useOnlineStatus';

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center text-[11px] sm:text-xs font-bold py-2 px-4 flex items-center justify-center gap-2 shadow-md">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Anda sedang offline — perubahan tetap tersimpan dan akan tersinkron otomatis saat koneksi kembali.</span>
    </div>
  );
}
