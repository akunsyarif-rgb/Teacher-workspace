'use client';

import { useEffect, useRef, useState } from 'react';
import { loadFormDraft, saveFormDraft, removeFormDraft } from '@/lib/utils/formDraft';

type Options<T> = {
  /** Kunci draf; null = nonaktif (mis. konteks belum siap). */
  key: string | null;
  /** Nilai formulir saat ini (diserialisasi untuk disimpan). */
  value: T;
  /** Ada isi yang belum tersimpan? false → draf dihapus. */
  isDirty: boolean;
  /** Data server sudah dimuat? Pemulihan baru jalan setelah true supaya tidak tertimpa. */
  enabled: boolean;
  onRestore: (draft: T) => void;
};

/**
 * Autosave draf ke perangkat + pulihkan saat dibuka lagi. Mengembalikan `restored` (true bila draf dipulihkan
 * pada pemuatan ini) dan `dismiss` untuk menyembunyikan pemberitahuan.
 */
export function useFormDraft<T>({ key, value, isDirty, enabled, onRestore }: Options<T>) {
  const armed = useRef(false);
  const onRestoreRef = useRef(onRestore);
  useEffect(() => {
    onRestoreRef.current = onRestore;
  });
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    armed.current = false;
    let cancelled = false;
    // Asinkron: pemulihan tidak boleh men-set state secara sinkron di dalam effect.
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (!key || !enabled) {
        setRestored(false);
        return;
      }
      const draft = loadFormDraft<T>(key);
      if (draft !== undefined) {
        onRestoreRef.current(draft);
        setRestored(true);
      } else {
        setRestored(false);
      }
      armed.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!armed.current || !key) return;
    if (isDirty) saveFormDraft(key, JSON.parse(serialized) as T);
    else removeFormDraft(key);
  }, [key, serialized, isDirty]);

  return { restored, dismiss: () => setRestored(false) };
}
