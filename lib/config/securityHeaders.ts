// Header keamanan untuk semua respons. Dipisah dari next.config.ts supaya
// bisa diuji (tests/security-headers.test.ts).
//
// CSP: script-src/style-src memakai 'unsafe-inline' karena Next.js App Router
// menyisipkan skrip inline untuk hidrasi dan CSP berbasis nonce butuh render
// dinamis per-request di seluruh aplikasi. Perlindungan utamanya tetap: daftar
// host yang diizinkan (tanpa skrip pihak ketiga selain Midtrans Snap),
// object-src 'none', base-uri/form-action 'self', dan frame-ancestors 'none'.
// 'unsafe-eval' TIDAK dipasang di produksi.

export type SecurityHeaderEnv = {
  isProduction: boolean;
  /** NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true' (uji e2e lokal): izinkan localhost, tanpa upgrade-insecure-requests/HSTS. */
  useEmulator: boolean;
  /** Origin Supabase dari env (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL), bila ada. */
  supabaseOrigin?: string;
  /** Origin ingest Sentry dari NEXT_PUBLIC_SENTRY_DSN (agar browser boleh mengirim laporan galat), bila diaktifkan. */
  sentryOrigin?: string;
};

const MIDTRANS_HOSTS = [
  'https://app.midtrans.com',
  'https://app.sandbox.midtrans.com',
  'https://api.midtrans.com',
  'https://api.sandbox.midtrans.com',
];

// Firebase Auth/Firestore/Storage dari browser.
const FIREBASE_CONNECT = [
  'https://*.googleapis.com',
  'https://*.firebaseio.com',
  'wss://*.firebaseio.com',
  'https://*.firebaseapp.com',
];

export function originOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return undefined;
  }
}

export function buildCsp(env: SecurityHeaderEnv): string {
  const supabase = ['https://*.supabase.co', ...(env.supabaseOrigin ? [env.supabaseOrigin] : [])];
  const sentry = env.sentryOrigin ? [env.sentryOrigin] : [];
  const local = env.useEmulator ? ['http://127.0.0.1:*', 'http://localhost:*', 'ws://127.0.0.1:*', 'ws://localhost:*'] : [];

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(env.isProduction ? [] : ["'unsafe-eval'"]), ...MIDTRANS_HOSTS],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', ...local],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...FIREBASE_CONNECT, ...supabase, ...MIDTRANS_HOSTS, ...sentry, ...local],
    'frame-src': ["'self'", ...supabase, ...MIDTRANS_HOSTS, ...local],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };

  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (env.isProduction && !env.useEmulator) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export function buildSecurityHeaders(env: SecurityHeaderEnv): { key: string; value: string }[] {
  const headers = [
    { key: 'Content-Security-Policy', value: buildCsp(env) },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(self "https://app.midtrans.com" "https://app.sandbox.midtrans.com")' },
  ];
  // HSTS hanya bermakna lewat HTTPS; jangan dikirim di dev/emulator (http).
  if (env.isProduction && !env.useEmulator) {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' });
  }
  return headers;
}
