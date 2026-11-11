import { describe, expect, it } from 'vitest';
import { buildCsp, buildSecurityHeaders, originOf } from '../lib/config/securityHeaders';

const prod = { isProduction: true, useEmulator: false };
const header = (h: { key: string; value: string }[], k: string) => h.find((x) => x.key === k)?.value;

describe('buildSecurityHeaders (produksi)', () => {
  const h = buildSecurityHeaders(prod);

  it('memuat header standar', () => {
    expect(header(h, 'X-Frame-Options')).toBe('DENY');
    expect(header(h, 'X-Content-Type-Options')).toBe('nosniff');
    expect(header(h, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header(h, 'Strict-Transport-Security')).toMatch(/max-age=31536000; includeSubDomains/);
    expect(header(h, 'Permissions-Policy')).toMatch(/geolocation=\(\)/);
    expect(header(h, 'Content-Security-Policy')).toBeTruthy();
  });

  it('CSP ketat: tanpa eval, tanpa object, tidak bisa di-frame, base/form dikunci, upgrade-insecure', () => {
    const csp = buildCsp(prod);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp.match(/script-src[^;]*/)![0]).not.toContain('unsafe-eval');
    expect(csp.match(/script-src[^;]*/)![0]).not.toMatch(/ \*( |$)|https:( |$)/); // bukan wildcard skrip
    expect(csp).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('mengizinkan layanan yang dipakai app: Firebase, Supabase (unduh/unggah/iframe PDF), Midtrans Snap', () => {
    const csp = buildCsp({ ...prod, supabaseOrigin: 'https://proj.example-db.co' });
    expect(csp.match(/connect-src[^;]*/)![0]).toMatch(/googleapis\.com/);
    expect(csp.match(/connect-src[^;]*/)![0]).toMatch(/supabase\.co/);
    expect(csp.match(/connect-src[^;]*/)![0]).toContain('https://proj.example-db.co');
    expect(csp.match(/frame-src[^;]*/)![0]).toMatch(/supabase\.co/);
    expect(csp.match(/script-src[^;]*/)![0]).toContain('https://app.midtrans.com');
    expect(csp.match(/script-src[^;]*/)![0]).toContain('https://app.sandbox.midtrans.com');
  });
});

describe('dev dan emulator', () => {
  it('dev: eval diizinkan (HMR) dan tanpa HSTS / upgrade-insecure-requests', () => {
    const h = buildSecurityHeaders({ isProduction: false, useEmulator: false });
    expect(header(h, 'Content-Security-Policy')).toContain("'unsafe-eval'");
    expect(header(h, 'Strict-Transport-Security')).toBeUndefined();
    expect(header(h, 'Content-Security-Policy')).not.toContain('upgrade-insecure-requests');
  });
  it('produksi + emulator (e2e lokal): localhost diizinkan, tanpa HSTS/upgrade (http)', () => {
    const h = buildSecurityHeaders({ isProduction: true, useEmulator: true });
    expect(header(h, 'Content-Security-Policy')).toMatch(/connect-src[^;]*http:\/\/127\.0\.0\.1:\*/);
    expect(header(h, 'Strict-Transport-Security')).toBeUndefined();
    expect(header(h, 'Content-Security-Policy')).not.toContain('upgrade-insecure-requests');
    expect(header(h, 'Content-Security-Policy')).not.toContain("'unsafe-eval'");
  });
});

describe('originOf', () => {
  it('mengambil origin dari URL (membuang path) dan mengabaikan nilai tidak valid', () => {
    expect(originOf(' https://x.supabase.co/rest/v1/ ')).toBe('https://x.supabase.co');
    expect(originOf('bukan url')).toBeUndefined();
    expect(originOf(undefined)).toBeUndefined();
  });
});
