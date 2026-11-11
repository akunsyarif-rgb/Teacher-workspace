import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, redactString, sanitize, serializeError, setErrorReporter, setLogSink } from '../lib/utils/logger';

let lines: { level: string; line: string }[] = [];
const last = () => JSON.parse(lines[lines.length - 1].line);

beforeEach(() => {
  lines = [];
  setLogSink((level, line) => lines.push({ level, line }));
  delete process.env.LOG_LEVEL;
});
afterEach(() => {
  setLogSink(null);
  setErrorReporter(null);
  vi.restoreAllMocks();
});

describe('format keluaran', () => {
  it('satu baris JSON dengan level, time (ISO), event, dan konteks', () => {
    logger.info('payment.created', { orderId: 'TW-1', amount: 19000 });
    expect(lines).toHaveLength(1);
    expect(lines[0].line).not.toContain('\n');
    expect(last()).toMatchObject({ level: 'info', event: 'payment.created', orderId: 'TW-1', amount: 19000 });
    expect(new Date(last().time).toString()).not.toBe('Invalid Date');
  });

  it('child() menyertakan konteks tetap; konteks pemanggil menambah', () => {
    const log = logger.child({ route: 'payments/webhook' });
    log.warn('rejected', { status: 401 });
    expect(last()).toMatchObject({ level: 'warn', route: 'payments/webhook', status: 401 });
  });

  it('tanpa sink: error -> console.error, warn -> console.warn, info -> console.info', () => {
    setLogSink(null);
    const e = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const i = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.error('a');
    logger.warn('b');
    logger.info('c');
    expect([e.mock.calls.length, w.mock.calls.length, i.mock.calls.length]).toEqual([1, 1, 1]);
    expect(JSON.parse(String(e.mock.calls[0][0])).event).toBe('a');
  });
});

describe('level', () => {
  it('LOG_LEVEL menyaring kejadian di bawahnya', () => {
    process.env.LOG_LEVEL = 'warn';
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });
});

describe('penyamaran rahasia', () => {
  it('kunci sensitif disamarkan pada semua kedalaman', () => {
    logger.error('x', {
      authorization: 'Bearer abc.def.ghi',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig',
      nested: { password: 'p', FIREBASE_ADMIN_SERVICE_ACCOUNT: '{"private_key":"x"}', ok: 'aman', deep: { apiKey: 'k', signature_key: 's' } },
      serverKey: 'tetap-terlihat?',
    });
    const l = last();
    expect(l.authorization).toBe('[REDACTED]');
    expect(l.idToken).toBe('[REDACTED]');
    expect(l.nested.password).toBe('[REDACTED]');
    expect(l.nested.FIREBASE_ADMIN_SERVICE_ACCOUNT).toBe('[REDACTED]');
    expect(l.nested.deep).toEqual({ apiKey: '[REDACTED]', signature_key: '[REDACTED]' });
    expect(l.nested.ok).toBe('aman');
  });

  it('pola rahasia di dalam NILAI string (JWT, Bearer, private key, kunci Supabase/Midtrans)', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl';
    expect(redactString(`gagal untuk ${jwt}`)).toBe('gagal untuk [JWT]');
    expect(redactString('Authorization: Bearer abc123.def-456')).toContain('Bearer [REDACTED]');
    expect(redactString('-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----')).toBe('[PRIVATE KEY]');
    expect(redactString('key sb_secret_abcDEF123 dan SB-Mid-server-xyz789')).toBe('key sb_secret_[REDACTED] dan SB-Mid-server-[REDACTED]');
  });

  it('string panjang dipotong; array/objek besar dibatasi; kedalaman dibatasi; sirkular tidak meledak', () => {
    expect((sanitize('x'.repeat(5000)) as string).length).toBeLessThan(600);
    expect((sanitize(Array.from({ length: 500 }, (_, i) => i)) as number[]).length).toBe(40);
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(JSON.stringify(sanitize(deep))).toContain('[depth]');
    const circ: Record<string, unknown> = { name: 'x' };
    circ.self = circ;
    expect(() => logger.error('circ', { circ })).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});

describe('error', () => {
  it('diserialisasi dengan name, code, message tersamar, dan stack ringkas', () => {
    const err = Object.assign(new Error('gagal pakai Bearer abc.def dan sb_secret_ZZZ'), { code: 'auth/id-token-revoked' });
    logger.error('auth.failed', { err });
    const e = last().error;
    expect(e).toMatchObject({ name: 'Error', code: 'auth/id-token-revoked' });
    expect(e.message).not.toContain('abc.def');
    expect(e.message).not.toContain('ZZZ');
    expect(e.stack.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('nilai non-Error (string/objek) tetap aman', () => {
    expect(serializeError('boom Bearer xyz').message).toBe('boom Bearer [REDACTED]');
    expect(serializeError({ a: 1 }).name).toBe('object');
  });
});

describe('titik sambung Sentry (setErrorReporter)', () => {
  it('dipanggil untuk logger.error yang membawa err — dengan konteks tersamar', () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const err = new Error('x');
    logger.error('webhook.failed', { err, orderId: 'TW-1', token: 'rahasia' });
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter.mock.calls[0][0]).toBe(err);
    expect(reporter.mock.calls[0][1]).toMatchObject({ event: 'webhook.failed', orderId: 'TW-1', token: '[REDACTED]' });
  });

  it('tidak dipanggil untuk warn/info atau error tanpa err; reporter yang melempar tidak menjatuhkan request', () => {
    const reporter = vi.fn(() => {
      throw new Error('sentry down');
    });
    setErrorReporter(reporter);
    logger.warn('w', { err: new Error('x') });
    logger.error('tanpa-err');
    expect(reporter).not.toHaveBeenCalled();
    expect(() => logger.error('dengan-err', { err: new Error('x') })).not.toThrow();
    expect(reporter).toHaveBeenCalledTimes(1);
  });
});

describe('penggunaan di server', () => {
  it('tidak ada console.* mentah tersisa di route /api dan lib/server', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const full = path.join(dir, f);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs)$/.test(f) && !full.endsWith('logger.ts')) files.push(full);
      }
    };
    walk(path.resolve(__dirname, '..', 'app', 'api'));
    walk(path.resolve(__dirname, '..', 'lib', 'server'));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/console\.(log|error|warn|info|debug)\(/);
  });
});
