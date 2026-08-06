'use client';

import { useState, useEffect } from 'react';

export function useOnlineStatus(): boolean {
  // Selalu mulai dari `true`, TIDAK dari navigator.onLine. HTML hasil
  // render server tidak pernah tahu status koneksi, jadi kalau nilai awal
  // di klien dibaca dari navigator, render pertama keduanya berbeda dan
  // React melempar hydration mismatch — tepat ketika pengguna membuka
  // aplikasi dalam keadaan offline, skenario yang justru wajib mulus di
  // aplikasi ini. Status sebenarnya diisi di useEffect (hanya jalan di
  // klien, setelah hydration selesai).
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
