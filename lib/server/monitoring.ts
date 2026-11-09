import { setErrorReporter } from '../utils/logger';
import { createSentryReporter } from '../utils/sentryReporter';
import { logger } from '../utils/logger';

let initialized = false;

// Menyalakan pelaporan kesalahan server ke Sentry bila DSN diisi. Dipanggil sekali dari instrumentation.ts.
// Placeholder: NEXT_PUBLIC_SENTRY_DSN (DSN Sentry bersifat publik-aman; dipakai juga oleh browser).
export function initMonitoring(env: Record<string, string | undefined> = process.env): boolean {
  if (initialized) return true;
  const reporter = createSentryReporter({
    dsn: env.NEXT_PUBLIC_SENTRY_DSN || env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.VERCEL_ENV || env.NODE_ENV,
    release: env.NEXT_PUBLIC_SENTRY_RELEASE || env.VERCEL_GIT_COMMIT_SHA,
    platform: 'node',
  });
  if (!reporter) {
    logger.info('monitoring.disabled', { reason: 'SENTRY_DSN belum diisi atau tidak valid' });
    return false;
  }
  setErrorReporter(reporter);
  initialized = true;
  logger.info('monitoring.enabled', { provider: 'sentry' });
  return true;
}

/** Untuk pengujian. */
export function resetMonitoringForTests() {
  initialized = false;
  setErrorReporter(null);
}
