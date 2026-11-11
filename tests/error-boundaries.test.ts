import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import ErrorPage from '../app/error';
import StudentError from '../app/student/error';
import GlobalError from '../app/global-error';
import NotFound from '../app/not-found';

// Render statis (node): membuktikan isi yang dilihat pengguna. Perilaku tombol
// "Coba lagi" (reset) diuji terpisah lewat pemanggilan langsung.
const SECRET = 'FIREBASE_ADMIN_SERVICE_ACCOUNT private_key=abc /srv/app/lib/server/secret.ts:42 at Object.<anonymous>';
const boom = Object.assign(new Error(SECRET), { digest: 'dg-123456', stack: `Error: ${SECRET}\n    at x (/srv/app/y.ts:1:1)` });
const reset = vi.fn();

const pages: [string, () => string][] = [
  ['error.tsx', () => renderToStaticMarkup(createElement(ErrorPage, { error: boom, reset }))],
  ['student/error.tsx', () => renderToStaticMarkup(createElement(StudentError, { error: boom, reset }))],
  ['global-error.tsx', () => renderToStaticMarkup(createElement(GlobalError, { error: boom, reset }))],
];

describe.each(pages)('%s', (_name, render) => {
  const html = render();

  it('TIDAK membocorkan pesan error, stack trace, path, atau konfigurasi', () => {
    expect(html).not.toContain('FIREBASE_ADMIN');
    expect(html).not.toContain('private_key');
    expect(html).not.toContain('/srv/app');
    expect(html).not.toContain('secret.ts');
    expect(html).not.toMatch(/Object\.<anonymous>|at x \(/);
  });

  it('menampilkan pesan ramah (bahasa Indonesia), kode referensi (digest), dan tombol pemulihan', () => {
    expect(html).toMatch(/Coba lagi/);
    expect(html).toContain('dg-123456');
    expect(html).toMatch(/aman/);
    expect(html).toMatch(/href="\/(student)?"/);
  });

  it('tanpa digest tidak menampilkan baris kode referensi', () => {
    const bare = Object.assign(new Error(SECRET), {});
    const out = renderToStaticMarkup(createElement(_name === 'global-error.tsx' ? GlobalError : _name === 'error.tsx' ? ErrorPage : StudentError, { error: bare, reset }));
    expect(out).not.toContain('Kode referensi');
    expect(out).not.toContain('FIREBASE_ADMIN');
  });
});

describe('semantik halaman', () => {
  it('global-error memuat <html> dan <body> sendiri (menggantikan layout root) dengan lang="id"', () => {
    const html = renderToStaticMarkup(createElement(GlobalError, { error: boom, reset }));
    expect(html).toMatch(/^<html lang="id">/);
    expect(html).toContain('<body');
  });

  it('error.tsx memakai role="alert" dan tautan pulang yang benar; student error ke /student', () => {
    expect(renderToStaticMarkup(createElement(ErrorPage, { error: boom, reset }))).toContain('role="alert"');
    expect(renderToStaticMarkup(createElement(StudentError, { error: boom, reset }))).toContain('href="/student"');
  });

  it('not-found: pesan jelas dan tautan ke beranda', () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toContain('Halaman tidak ditemukan');
    expect(html).toContain('href="/"');
  });

  it.each(['app/error.tsx', 'app/student/error.tsx', 'app/global-error.tsx'])('%s hanya mencatat digest ke console, bukan message/stack', (file) => {
    const src = readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    const calls = src.match(/console\.error\([^;]*\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c).toContain('error.digest');
      expect(c).not.toMatch(/error\.message|error\.stack|String\(error\)|,\s*error\s*\)/);
    }
  });
});
