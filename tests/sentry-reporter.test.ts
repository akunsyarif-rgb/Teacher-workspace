import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEnvelope, buildEvent, captureClientError, createSentryReporter, dsnOrigin, installGlobalErrorHandlers, parseDsn, resetClientReporterForTests,
} from '../lib/utils/sentryReporter';
import { logger, setErrorReporter, setLogSink } from '../lib/utils/logger';
import { initMonitoring, resetMonitoringForTests } from '../lib/server/monitoring';
import { onRequestError } from '../instrumentation';
import { buildCsp } from '../lib/config/securityHeaders';

const DSN = 'https://abc123publickey@o4501.ingest.sentry.io/98765';
const okFetch = () => vi.fn(async (..._a: unknown[]) => new Response('{}', { status: 200 }));
const sentBody = (f: ReturnType<typeof okFetch>, i = 0) => String((f.mock.calls[i][1] as RequestInit).body);

beforeEach(() => {
  setLogSink(() => undefined);
  resetMonitoringForTests();
  resetClientReporterForTests();
});
afterEach(() => {
  setLogSink(null);
  setErrorReporter(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseDsn / dsnOrigin', () => {
  it('DSN Sentry Cloud', () => {
    expect(parseDsn(DSN)).toEqual({ protocol: 'https', publicKey: 'abc123publickey', host: 'o4501.ingest.sentry.io', projectId: '98765', pathPrefix: '' });
    expect(dsnOrigin(DSN)).toBe('https://o4501.ingest.sentry.io');
  });
  it('self-hosted dengan port dan prefix path; DSN lama dengan secret', () => {
    expect(parseDsn('http://key@sentry.local:9000/sub/7')).toMatchObject({ host: 'sentry.local:9000', pathPrefix: '/sub', projectId: '7' });
    expect(parseDsn('https://key:secret@host.example/12')).toMatchObject({ publicKey: 'key', projectId: '12' });
  });
  it.each([undefined, null, '', 'bukan dsn', 'https://host/123', 'https://key@host/abc', 'ftp://key@host/1'])('tidak valid -> null (%s)', (v) => {
    expect(parseDsn(v as never)).toBeNull();
    expect(dsnOrigin(v as never)).toBeNull();
  });
});

describe('envelope dan event', () => {
  it('envelope 3 baris JSON sesuai protokol: header(event_id, sent_at, dsn), item {type:event}, event', () => {
    const err = Object.assign(new Error('boom'), { code: 'E_X' });
    const event = buildEvent(err, { event: 'webhook.failed', orderId: 'TW-1' }, { environment: 'production', release: 'abc', platform: 'node', now: 1_700_000_000_000 });
    const lines = buildEnvelope(event, DSN, '2023-11-14T22:13:20.000Z').split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({ event_id: event.event_id, sent_at: '2023-11-14T22:13:20.000Z', dsn: DSN });
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' });
    const e = JSON.parse(lines[2]);
    expect(e).toMatchObject({
      level: 'error', platform: 'node', environment: 'production', release: 'abc', timestamp: 1_700_000_000,
      exception: { values: [{ type: 'Error', value: 'boom' }] },
      tags: { event: 'webhook.failed', runtime: 'node' }, fingerprint: ['webhook.failed', 'Error'],
    });
    expect(e.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(e.extra).toMatchObject({ orderId: 'TW-1', code: 'E_X' });
  });

  it('rahasia disamarkan: pesan, stack, dan kunci konteks (token, authorization, kunci)', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl';
    const err = new Error(`gagal Bearer abc.def.ghi untuk ${jwt} sb_secret_RAHASIA`);
    const e = buildEvent(err, { event: 'x', authorization: 'Bearer zzz', idToken: jwt, nested: { password: 'p', ok: 'aman' } }, { platform: 'node', now: 1 });
    const text = JSON.stringify(e);
    expect(text).not.toContain('abc.def.ghi');
    expect(text).not.toContain('RAHASIA');
    expect(text).not.toContain(jwt);
    expect(text).not.toContain('"p"');
    expect(e.extra.nested).toEqual({ password: '[REDACTED]', ok: 'aman' });
  });
});

describe('createSentryReporter', () => {
  it('tanpa DSN valid -> null (tidak ada pelapor, tidak ada pengiriman)', () => {
    expect(createSentryReporter({ dsn: undefined })).toBeNull();
    expect(createSentryReporter({ dsn: 'rusak' })).toBeNull();
  });

  it('POST ke /api/<proyek>/envelope/ dengan header X-Sentry-Auth dan keepalive', () => {
    const f = okFetch();
    createSentryReporter({ dsn: DSN, fetchImpl: f as never, platform: 'node' })!(new Error('x'), { event: 'a' });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://o4501.ingest.sentry.io/api/98765/envelope/');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    const h = init.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('application/x-sentry-envelope');
    expect(h['X-Sentry-Auth']).toBe('Sentry sentry_version=7, sentry_client=teacher-workspace/1.0, sentry_key=abc123publickey');
  });

  it('fetch gagal (reject maupun melempar sinkron) tidak menjatuhkan pemanggil', async () => {
    const rejecting = vi.fn(async () => { throw new Error('jaringan'); });
    const throwing = vi.fn(() => { throw new Error('sync'); });
    expect(() => createSentryReporter({ dsn: DSN, fetchImpl: rejecting as never })!(new Error('a'), { event: 'a' })).not.toThrow();
    expect(() => createSentryReporter({ dsn: DSN, fetchImpl: throwing as never })!(new Error('a'), { event: 'a' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 5)); // tidak ada unhandled rejection
  });

  it('batas 30 event/menit lalu pulih pada menit berikutnya', () => {
    const f = okFetch();
    let t = 0;
    const report = createSentryReporter({ dsn: DSN, fetchImpl: f as never, now: () => t, maxPerMinute: 3 })!;
    for (let i = 0; i < 10; i++) report(new Error(`beda-${i}`), { event: 'e' });
    expect(f).toHaveBeenCalledTimes(3);
    t = 61_000;
    report(new Error('baru'), { event: 'e' });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('galat identik dalam 30 detik hanya dikirim sekali', () => {
    const f = okFetch();
    let t = 1000;
    const report = createSentryReporter({ dsn: DSN, fetchImpl: f as never, now: () => t })!;
    report(new Error('sama'), { event: 'e' });
    report(new Error('sama'), { event: 'e' });
    expect(f).toHaveBeenCalledTimes(1);
    t += 31_000;
    report(new Error('sama'), { event: 'e' });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('terhubung ke logger (server)', () => {
  it('tanpa DSN: initMonitoring false, logger.error tidak mengirim apa pun', () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    expect(initMonitoring({})).toBe(false);
    logger.error('x', { err: new Error('a') });
    expect(f).not.toHaveBeenCalled();
  });

  it('dengan DSN: logger.error yang membawa err dikirim; warn/info/tanpa err tidak; idempoten', () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    expect(initMonitoring({ NEXT_PUBLIC_SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'staging' })).toBe(true);
    expect(initMonitoring({})).toBe(true); // sudah menyala: tidak mendaftar ulang
    logger.error('payment.failed', { err: new Error('kena'), orderId: 'TW-9' });
    logger.warn('w', { err: new Error('abaikan') });
    logger.info('i');
    logger.error('tanpa-err');
    expect(f).toHaveBeenCalledTimes(1);
    const e = JSON.parse(sentBody(f).split('\n')[2]);
    expect(e).toMatchObject({ environment: 'staging', platform: 'node', tags: { event: 'payment.failed' } });
  });
});

describe('onRequestError (instrumentation.ts)', () => {
  it('mencatat galat tak tertangani dengan rute (tanpa query/id) lewat logger', async () => {
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    await onRequestError(new Error('render gagal'), { path: '/classes?token=RAHASIA&x=1', method: 'GET' }, { routeType: 'render', routerKind: 'App Router' });
    const rec = JSON.parse(lines[0]);
    expect(rec).toMatchObject({ level: 'error', event: 'request.unhandled', method: 'GET', route: '/classes', routeType: 'render' });
    expect(lines[0]).not.toContain('RAHASIA');
    expect(rec.error.message).toBe('render gagal');
  });
  it('lewat Sentry bila aktif', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    initMonitoring({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    await onRequestError(new Error('boom'), { path: '/x' }, { routePath: '/api/students/create', routeType: 'route' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sentBody(f).split('\n')[2]).extra.route).toBe('/api/students/create');
  });
});

describe('browser', () => {
  it('captureClientError: no-op tanpa DSN; dengan DSN mengirim sebagai client.error beserta digest', () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    captureClientError(new Error('a'));
    expect(f).not.toHaveBeenCalled();

    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', DSN);
    resetClientReporterForTests();
    captureClientError(Object.assign(new Error('ui rusak'), { digest: 'dg-1' }), { boundary: 'app/error' });
    expect(f).toHaveBeenCalledTimes(1);
    const e = JSON.parse(sentBody(f).split('\n')[2]);
    expect(e).toMatchObject({ platform: 'javascript', tags: { event: 'client.error' }, extra: { digest: 'dg-1', boundary: 'app/error' } });
  });

  it('installGlobalErrorHandlers: error dan unhandledrejection (termasuk bukan-Error) diteruskan; pelepas berfungsi', () => {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const target = {
      addEventListener: (t: string, h: (e: unknown) => void) => void (listeners[t] ??= []).push(h),
      removeEventListener: (t: string, h: (e: unknown) => void) => { listeners[t] = (listeners[t] ?? []).filter((x) => x !== h); },
    };
    const capture = vi.fn();
    const off = installGlobalErrorHandlers(target, capture);
    const boom = new Error('x');
    listeners.error[0]({ error: boom });
    listeners.error[0]({ message: 'Script error.' });
    listeners.unhandledrejection[0]({ reason: 'string biasa' });
    expect(capture.mock.calls[0]).toEqual([boom, { source: 'window.error' }]);
    expect((capture.mock.calls[1][0] as Error).message).toBe('Script error.');
    expect((capture.mock.calls[2][0] as Error).message).toBe('string biasa');
    off();
    expect(listeners.error).toHaveLength(0);
    expect(listeners.unhandledrejection).toHaveLength(0);
  });

  it('error boundary memanggil captureClientError (dan tetap hanya mencatat digest ke console)', () => {
    for (const f of ['app/error.tsx', 'app/student/error.tsx', 'app/global-error.tsx']) {
      expect(readFileSync(path.resolve(__dirname, '..', f), 'utf8'), f).toContain('captureClientError(error');
    }
  });
});

describe('CSP', () => {
  const base = { isProduction: true, useEmulator: false };
  it('origin Sentry ditambahkan ke connect-src hanya bila DSN diisi', () => {
    expect(buildCsp({ ...base, sentryOrigin: dsnOrigin(DSN)! })).toMatch(/connect-src[^;]*https:\/\/o4501\.ingest\.sentry\.io/);
    expect(buildCsp(base)).not.toContain('sentry');
  });
});
