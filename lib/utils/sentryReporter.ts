import { redactString, sanitize, serializeError, type ErrorReporter } from './logger';

// Pelapor kesalahan ke Sentry TANPA SDK: mengirim "envelope" lewat fetch (protokol Sentry yang terdokumentasi).
// Dipilih agar tidak menambah dependensi/bundle dan agar CSP/kontrolnya sederhana; saat butuh source map dan tracing,
// ganti dengan @sentry/nextjs (titik sambungnya tetap setErrorReporter di lib/utils/logger.ts).
//
// Privasi: yang dikirim hanya hasil serializeError/sanitize milik logger (rahasia, token, JWT disamarkan, string dipotong).
// Tidak ada data pengguna (PII) yang sengaja dikirim. Tanpa DSN semuanya no-op.
//
// Batasan: stack trace dikirim sebagai teks (tidak ter-symbolicate). Belum diuji terhadap endpoint Sentry sungguhan
// (butuh DSN); bentuk envelope mengikuti spesifikasi protokol dan diuji dengan fetch palsu.

export type ParsedDsn = { protocol: string; publicKey: string; host: string; projectId: string; pathPrefix: string };

export function parseDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn || typeof dsn !== 'string') return null;
  // protocol://publicKey[:secret]@host[:port][/prefix]/projectId
  const m = dsn.trim().match(/^(https?):\/\/([^:@/]+)(?::[^@]*)?@([^/]+)((?:\/[^/]+)*?)\/(\d+)\/?$/);
  if (!m) return null;
  return { protocol: m[1], publicKey: m[2], host: m[3], pathPrefix: m[4] ?? '', projectId: m[5] };
}

/** Origin ingest Sentry (untuk CSP connect-src), mis. https://o123.ingest.sentry.io — null bila DSN tidak valid. */
export function dsnOrigin(dsn: string | undefined | null): string | null {
  const p = parseDsn(dsn);
  return p ? `${p.protocol}://${p.host}` : null;
}

export type SentryEvent = {
  event_id: string;
  timestamp: number;
  level: 'error';
  platform: 'node' | 'javascript';
  environment?: string;
  release?: string;
  exception: { values: { type: string; value: string; mechanism: { type: string; handled: boolean } }[] };
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  fingerprint: string[];
};

export type ReporterOptions = {
  dsn: string | undefined | null;
  environment?: string;
  release?: string;
  platform?: 'node' | 'javascript';
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Batas kirim per menit (anti banjir saat terjadi galat beruntun). */
  maxPerMinute?: number;
};

const newEventId = () => globalThis.crypto.randomUUID().replace(/-/g, '');

export function buildEvent(error: unknown, context: Record<string, unknown>, opts: { environment?: string; release?: string; platform: 'node' | 'javascript'; now: number }): SentryEvent {
  const err = serializeError(error);
  const { event, ...rest } = context;
  const eventName = typeof event === 'string' ? event : 'unknown';
  return {
    event_id: newEventId(),
    timestamp: opts.now / 1000,
    level: 'error',
    platform: opts.platform,
    ...(opts.environment ? { environment: opts.environment } : {}),
    ...(opts.release ? { release: opts.release } : {}),
    exception: { values: [{ type: String(err.name ?? 'Error'), value: redactString(String(err.message ?? '')), mechanism: { type: 'generic', handled: true } }] },
    tags: { event: eventName, runtime: opts.platform },
    extra: { ...(sanitize(rest) as Record<string, unknown>), ...(err.stack ? { stack: err.stack } : {}), ...(err.code !== undefined ? { code: err.code } : {}) },
    fingerprint: [eventName, String(err.name ?? 'Error')],
  };
}

export function buildEnvelope(event: SentryEvent, dsn: string, sentAtIso: string): string {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: sentAtIso, dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
}

/** null bila DSN kosong/tidak valid (tidak ada yang dikirim). */
export function createSentryReporter(opts: ReporterOptions): ErrorReporter | null {
  const dsn = parseDsn(opts.dsn);
  if (!dsn || !opts.dsn) return null;
  const rawDsn = opts.dsn.trim();
  const now = opts.now ?? Date.now;
  const platform = opts.platform ?? (typeof window === 'undefined' ? 'node' : 'javascript');
  const maxPerMinute = opts.maxPerMinute ?? 30;
  const url = `${dsn.protocol}://${dsn.host}${dsn.pathPrefix}/api/${dsn.projectId}/envelope/`;
  const auth = `Sentry sentry_version=7, sentry_client=teacher-workspace/1.0, sentry_key=${dsn.publicKey}`;

  let windowStart = 0;
  let sentInWindow = 0;
  const recent = new Map<string, number>(); // kunci galat -> waktu kirim terakhir (dedupe 30 dtk)

  return (error, context) => {
    try {
      const t = now();
      if (t - windowStart >= 60_000) {
        windowStart = t;
        sentInWindow = 0;
      }
      if (sentInWindow >= maxPerMinute) return;

      const event = buildEvent(error, context, { environment: opts.environment, release: opts.release, platform, now: t });
      const dedupeKey = `${event.fingerprint.join('|')}|${event.exception.values[0].value}`;
      const last = recent.get(dedupeKey);
      if (last !== undefined && t - last < 30_000) return;
      recent.set(dedupeKey, t);
      if (recent.size > 200) recent.clear();

      sentInWindow += 1;
      const body = buildEnvelope(event, rawDsn, new Date(t).toISOString());
      const p = (opts.fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': auth },
        body,
        keepalive: true,
      });
      void Promise.resolve(p).catch(() => undefined);
    } catch {
      // pelaporan tidak boleh menjatuhkan aplikasi
    }
  };
}

// ---------- Browser ----------
let clientReporter: ErrorReporter | null | undefined;

function getClientReporter(): ErrorReporter | null {
  if (clientReporter === undefined) {
    clientReporter = createSentryReporter({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, // literal: dibenamkan Next.js saat build
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
      platform: 'javascript',
    });
  }
  return clientReporter;
}

/** Untuk pengujian. */
export function resetClientReporterForTests() {
  clientReporter = undefined;
}

/** Laporkan galat di browser (error boundary, error global). No-op tanpa NEXT_PUBLIC_SENTRY_DSN. */
export function captureClientError(error: unknown, context: Record<string, unknown> = {}) {
  const reporter = getClientReporter();
  if (!reporter) return;
  const digest = (error as { digest?: unknown } | null)?.digest;
  reporter(error, { event: 'client.error', ...(typeof digest === 'string' ? { digest } : {}), ...context });
}

// Subset dari EventTarget/Window yang dipakai (longgar agar `window` dan objek palsu uji sama-sama diterima).
type Target = {
  addEventListener(type: string, handler: (event: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  removeEventListener(type: string, handler: (event: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** Pasang penangkap galat global (error + unhandledrejection). Mengembalikan fungsi pelepas. */
export function installGlobalErrorHandlers(target: Target, capture: (error: unknown, context: Record<string, unknown>) => void = captureClientError): () => void {
  const onError = (e: { error?: unknown; message?: string }) => capture(e.error ?? new Error(String(e.message ?? 'window.onerror')), { source: 'window.error' });
  const onRejection = (e: { reason?: unknown }) => capture(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), { source: 'unhandledrejection' });
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
