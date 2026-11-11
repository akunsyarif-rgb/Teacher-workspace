// Logger terpusat untuk kode SERVER (route /api, webhook, layanan server).
//
// - Satu baris JSON per kejadian: {level, time, event, ...context} — mudah dicari di log
//   Vercel dan siap diteruskan ke penyedia log/Sentry.
// - Rahasia disamarkan otomatis: kunci bernama token/secret/password/authorization/
//   private_key/dst, nilai berbentuk JWT atau "Bearer ...", dan string terlalu panjang dipotong.
// - Error diserialisasi aman (name, code, message yang sudah disamarkan, stack ringkas).
// - Titik sambung Sentry: setErrorReporter(fn) — dipanggil untuk setiap logger.error yang
//   membawa `err`. Belum ada integrasi vendor; tinggal mendaftarkan fungsinya sekali saat boot.
//
// Pesan error mentah TIDAK pernah dikirim ke client; log ini satu-satunya tempat detailnya.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown> & { err?: unknown };

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /token|secret|password|passwd|authorization|cookie|api[-_]?key|private[-_]?key|service[-_]?account|signature|credential|session/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;

export type ErrorReporter = (error: unknown, context: Record<string, unknown>) => void;
export type LogSink = (level: LogLevel, line: string) => void;

let reporter: ErrorReporter | null = null;
let sink: LogSink | null = null;

/** Hubungkan ke Sentry (atau sejenisnya): dipanggil untuk setiap logger.error yang membawa `err`. */
export function setErrorReporter(fn: ErrorReporter | null) {
  reporter = fn;
}

/** Ganti tujuan keluaran (pengujian / penyedia log lain). null = console. */
export function setLogSink(fn: LogSink | null) {
  sink = fn;
}

function minLevel(): number {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase() as LogLevel;
  if (configured in LEVEL_ORDER) return LEVEL_ORDER[configured];
  return process.env.NODE_ENV === 'production' ? LEVEL_ORDER.info : LEVEL_ORDER.debug;
}

export function redactString(value: string): string {
  let out = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[JWT]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[PRIVATE KEY]')
    .replace(/(sb_secret_|sk-|SB-Mid-server-)[A-Za-z0-9_-]+/g, '$1[REDACTED]');
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[+${out.length - MAX_STRING}]`;
  return out;
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return {
      name: err.name,
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      message: redactString(err.message),
      // Stack ringkas (8 baris) cukup untuk melacak; disamarkan seperti pesan.
      stack: err.stack ? redactString(err.stack.split('\n').slice(0, 8).join('\n')) : undefined,
    };
  }
  return { name: typeof err, message: redactString(String(err)) };
}

export function sanitize(value: unknown, depth = 0, key = ''): unknown {
  if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Error) return serializeError(value);
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) out[k] = sanitize(v, depth + 1, k);
    return out;
  }
  return `[${typeof value}]`;
}

function emit(level: LogLevel, event: string, context: LogContext = {}, base: Record<string, unknown> = {}) {
  if (LEVEL_ORDER[level] < minLevel()) return;

  const { err, ...rest } = context;
  const record: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    event,
    ...(sanitize({ ...base, ...rest }) as Record<string, unknown>),
    ...(err !== undefined ? { error: serializeError(err) } : {}),
  };

  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({ level, time: record.time, event, note: 'context tidak dapat diserialisasi' });
  }

  if (sink) sink(level, line);
  else if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'info') console.info(line);
  else console.debug(line);

  if (level === 'error' && err !== undefined && reporter) {
    try {
      reporter(err, sanitize({ event, ...base, ...rest }) as Record<string, unknown>);
    } catch {
      // pelaporan tidak boleh menjatuhkan request
    }
  }
}

export type Logger = {
  debug: (event: string, context?: LogContext) => void;
  info: (event: string, context?: LogContext) => void;
  warn: (event: string, context?: LogContext) => void;
  error: (event: string, context?: LogContext) => void;
  /** Logger turunan yang selalu menyertakan konteks tetap (mis. { route: 'payments/webhook' }). */
  child: (base: Record<string, unknown>) => Logger;
};

function make(base: Record<string, unknown>): Logger {
  return {
    debug: (event, context) => emit('debug', event, context, base),
    info: (event, context) => emit('info', event, context, base),
    warn: (event, context) => emit('warn', event, context, base),
    error: (event, context) => emit('error', event, context, base),
    child: (extra) => make({ ...base, ...extra }),
  };
}

export const logger: Logger = make({});
