'use client';

import { useEffect } from 'react';
import { installGlobalErrorHandlers } from '@/lib/utils/sentryReporter';

// Memasang penangkap galat global di browser (di luar render React: event handler, promise yang ditolak).
// No-op bila NEXT_PUBLIC_SENTRY_DSN kosong. Tidak merender apa pun.
export default function ClientMonitoring() {
  useEffect(() => installGlobalErrorHandlers(window), []);
  return null;
}
