import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

const require = createRequire(import.meta.url);

// Regresi ERR_REQUIRE_ESM di produksi.
//
// firebase-admin/auth menarik jwks-rsa, dan jwks-rsa (CommonJS) memanggil
// require('jose') di level modul — padahal jose v6 murni ESM. require(esm)
// baru didukung Node >=20.19 / >=22.12; di bawah itu impor-nya melempar
// ERR_REQUIRE_ESM. Karena impornya terjadi saat MEMUAT modul route, bukan saat
// handler jalan, kegagalannya muncul sebagai HTTP 500 tanpa pernah menyentuh
// kode kita — persis yang terjadi di Lambda Vercel:
//
//   Failed to load external module firebase-admin/auth:
//   ERR_REQUIRE_ESM: require() of ES Module .../jose/dist/webapi/index.js
//   from .../jwks-rsa/src/utils.js
//
// Build hijau TIDAK menangkap ini — build tidak pernah mengeksekusi API route.
// Test inilah yang menangkapnya, karena benar-benar menjalankan require yang
// sama di CI.

describe('Admin SDK bisa dimuat di runtime Node yang dipakai', () => {
  it('require("firebase-admin/auth") tidak melempar ERR_REQUIRE_ESM', () => {
    expect(() => require('firebase-admin/auth')).not.toThrow();
  });

  it('require("jwks-rsa") — mata rantai yang gagal di produksi', () => {
    expect(() => require('jwks-rsa')).not.toThrow();
  });

  it('Node yang menjalankan test ini mendukung require(esm)', () => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    const mendukung = major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
    expect(mendukung, `Node ${process.versions.node} tidak mendukung require(esm)`).toBe(true);
  });
});

describe('engines.node memakai format yang dibaca Vercel', () => {
  // Nilai sebelumnya ">=22.12.0" TIDAK berlaku di runtime Vercel — function
  // tetap jalan di Node lama dan rename kelas gagal 500. Format mayor-x
  // ("22.x") adalah bentuk yang didokumentasikan Vercel.
  it('bukan rentang semver, melainkan bentuk "<mayor>.x"', () => {
    expect(pkg.engines?.node).toMatch(/^\d+\.x$/);
  });

  it('mayornya minimal 22 — syarat firebase-admin v14 sekaligus require(esm)', () => {
    const major = Number(String(pkg.engines?.node).split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(22);
  });
});
