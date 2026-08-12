import { spawnSync } from 'node:child_process';
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
  it('bukan rentang semver, melainkan bentuk "<mayor>.x"', () => {
    expect(pkg.engines?.node).toMatch(/^\d+\.x$/);
  });

  it('mayornya minimal 22 — syarat firebase-admin v14', () => {
    const major = Number(String(pkg.engines?.node).split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(22);
  });
});

// INI test yang sebenarnya menangkap bug produksi. Test di atas berjalan pada
// Node lokal/CI yang kebetulan mendukung require(esm), jadi rantai ini lolos
// walau paketnya ESM-only — persis kenapa CI hijau sementara produksi 500.
//
// `--no-experimental-require-module` mematikan dukungan require(esm),
// mereproduksi runtime Vercel. Diverifikasi: tanpa override jose, perintah ini
// menghasilkan ERR_REQUIRE_ESM yang sama persis dengan log produksi; dengan
// override, berhasil.
describe('Admin SDK tetap termuat di runtime TANPA require(esm)', () => {
  function muatTanpaRequireEsm(spec: string) {
    return spawnSync(
      process.execPath,
      ['--no-experimental-require-module', '-e', `require(${JSON.stringify(spec)})`],
      { encoding: 'utf8' }
    );
  }

  it('firebase-admin/auth tidak melempar ERR_REQUIRE_ESM', () => {
    const hasil = muatTanpaRequireEsm('firebase-admin/auth');
    expect(hasil.stderr).not.toContain('ERR_REQUIRE_ESM');
    expect(hasil.status).toBe(0);
  });

  it('jwks-rsa — mata rantai yang gagal — juga termuat', () => {
    const hasil = muatTanpaRequireEsm('jwks-rsa');
    expect(hasil.stderr).not.toContain('ERR_REQUIRE_ESM');
    expect(hasil.status).toBe(0);
  });
});

describe('override jose menjaga rantai CJS tetap utuh', () => {
  it('jose yang dipakai jwks-rsa punya entry require (CJS)', () => {
    const josePkg = require('jwks-rsa/node_modules/jose/package.json');
    expect(josePkg.exports['.'].require).toBeTruthy();
  });

  it('override dipatok ke mayor 5 — v6 tidak punya entry CJS sama sekali', () => {
    expect(pkg.overrides?.jose).toMatch(/^\^?5\./);
  });

  it('keempat API yang dipakai jwks-rsa tersedia', () => {
    const jose = require('jwks-rsa/node_modules/jose');
    for (const api of ['decodeJwt', 'decodeProtectedHeader', 'exportSPKI', 'importJWK']) {
      expect(typeof jose[api], `${api} hilang di jose v5`).toBe('function');
    }
  });
});
