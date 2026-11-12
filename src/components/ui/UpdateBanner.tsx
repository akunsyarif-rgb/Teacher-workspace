'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { APP_VERSION } from '@/lib/config/appVersion';
import { isStaleClient, parseVersionResponse, shouldCheckNow } from '@/lib/utils/appVersion';

const MIN_CHECK_INTERVAL_MS = 30_000;

// Banner tidak mengganggu: muncul hanya bila server melayani versi yang berbeda dari bundel di perangkat ini.
// Dicek saat halaman dibuka, saat kembali ke aplikasi (fokus/visible), dan saat berpindah halaman — dibatasi 1x/30 dtk,
// gagal diam-diam saat offline. "Nanti" menyembunyikannya sampai ada versi yang lebih baru lagi.
export default function UpdateBanner() {
  const pathname = usePathname();
  const [remote, setRemote] = useState<string | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const lastChecked = useRef(0);
  const inFlight = useRef(false);

  const check = useCallback(async (force = false) => {
    if (!APP_VERSION || inFlight.current) return;
    const now = Date.now();
    if (!force && !shouldCheckNow(lastChecked.current, now, MIN_CHECK_INTERVAL_MS)) return;
    lastChecked.current = now;
    inFlight.current = true;
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;
      const version = parseVersionResponse(await res.json());
      if (version) setRemote(version);
    } catch {
      // offline / gangguan sesaat: coba lagi pada kesempatan berikutnya
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void check(true), 0); // tidak men-set state sinkron di dalam effect
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onFocus = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [check]);

  useEffect(() => {
    const t = setTimeout(() => void check(), 0);
    return () => clearTimeout(t);
  }, [pathname, check]);

  if (!isStaleClient(APP_VERSION, remote) || dismissedFor === remote) return null;

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="fixed left-1/2 -translate-x-1/2 bottom-24 xl:bottom-6 z-50 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-nb-ink text-white shadow-lg px-4 py-3 flex items-center gap-3"
    >
      <span className="text-xs font-medium flex-1">Muat ulang halaman untuk memperbarui aplikasi.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="px-3 py-1.5 rounded-xl bg-white text-nb-ink text-xs font-bold shrink-0"
      >
        Muat ulang
      </button>
      <button
        type="button"
        onClick={() => setDismissedFor(remote)}
        className="px-2 py-1.5 text-xs font-bold text-white/80 shrink-0"
        aria-label="Nanti saja"
      >
        Nanti
      </button>
    </div>
  );
}
