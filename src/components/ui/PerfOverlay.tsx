'use client';

import React, { useEffect, useState } from 'react';
import type { PerfEntry } from '@/lib/utils/perf';

// Tampil hanya kalau URL memuat ?perf=1 — untuk membaca hasil pengukuran
// di perangkat tanpa devtools (mis. iPad). Tidak tampil bagi pengguna biasa.
export default function PerfOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<PerfEntry[]>([]);

  useEffect(() => {
    const sync = () => setEntries(((window as unknown as { __perf?: PerfEntry[] }).__perf || []).slice());
    const t = setTimeout(() => {
      try {
        if (new URLSearchParams(window.location.search).get('perf') === '1') {
          setEnabled(true);
          sync();
        }
      } catch {}
    }, 0);
    window.addEventListener('perf-update', sync);
    return () => {
      clearTimeout(t);
      window.removeEventListener('perf-update', sync);
    };
  }, []);

  if (!enabled) return null;
  return (
    <div className="fixed top-2 left-2 z-[60] max-w-[60vw] max-h-[40vh] overflow-auto rounded-xl bg-black/80 p-2 text-[10px] leading-tight text-green-300 font-mono pointer-events-none">
      {entries.length === 0 ? 'perf: belum ada data' : entries.map((e, i) => <div key={i}>{e.label}: {e.ms}ms</div>)}
    </div>
  );
}
