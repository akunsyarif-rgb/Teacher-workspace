#!/usr/bin/env node
/**
 * Salin data Firestore -> Supabase (proyek "Workflow"), AMAN untuk data produksi:
 *  - HANYA MEMBACA Firestore. Tidak pernah menulis/menghapus apa pun di sana.
 *  - Tidak pernah DELETE di Supabase; hanya upsert (merge by primary key) —
 *    aman dijalankan berulang (idempotent), mis. sekali sekarang lalu sekali
 *    lagi saat cutover untuk menyusul data baru. Timestamp asli (created_at/
 *    updated_at) dijaga: trigger DB hanya mengizinkannya untuk service_role.
 *  - Field tanpa kolom khusus masuk ke `metadata` (jsonb); nilai yang gagal
 *    dikonversi tipenya disimpan mentah di metadata.__unparsed. Tidak ada
 *    data yang dibuang.
 *  - Default DRY-RUN: membaca + memvalidasi (NOT NULL, FK yatim, duplikat
 *    unik, tipe) tanpa menghubungi Supabase sama sekali.
 *  - --apply ditolak kalau validasi menemukan masalah, kecuali --allow-problems
 *    (baris bermasalah dilewati & dilaporkan, sisanya tetap masuk).
 *
 * Env:
 *   FIREBASE_ADMIN_SERVICE_ACCOUNT   JSON service account (satu baris)   [mode normal]
 *   SUPABASE_URL                     https://htutgpjcynbnyxwgorcb.supabase.co   [--apply]
 *   SUPABASE_SERVICE_ROLE_KEY        service_role key (rahasia; jangan di-commit)   [--apply]
 *
 * Pakai:
 *   node scripts/migrate-firestore-to-supabase.mjs                  # dry-run
 *   node scripts/migrate-firestore-to-supabase.mjs --apply          # tulis
 *   node scripts/migrate-firestore-to-supabase.mjs --fixture=DIR    # baca DIR/<koleksi>.json, bukan Firestore
 *   Opsi: --only=students,grades  --allow-problems
 */
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, mapDoc, validateAll } from './migration/mapping.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALLOW_PROBLEMS = args.includes('--allow-problems');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const FIXTURE = (args.find((a) => a.startsWith('--fixture=')) || '').slice(10);
const BATCH = 500;

async function readCollection(fsdb, name) {
  if (FIXTURE) {
    const file = path.join(FIXTURE, `${name}.json`);
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')).map(({ id, ...data }) => ({ id, data }));
  }
  const snap = await fsdb.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

async function sb(p, init = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${p}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

const UPSERT_HEADERS = { Prefer: 'resolution=merge-duplicates,return=minimal' };

async function upsert(spec, rows) {
  const url = `${spec.c}?on_conflict=${spec.pk}`;
  const res = await sb(url, { method: 'POST', headers: UPSERT_HEADERS, body: JSON.stringify(rows) });
  if (res.ok) return { ok: rows.length, failed: [] };
  // Batch gagal -> per baris, supaya baris sehat tetap masuk & yang bermasalah terlapor.
  let ok = 0;
  const failed = [];
  for (const r of rows) {
    const one = await sb(url, { method: 'POST', headers: UPSERT_HEADERS, body: JSON.stringify([r]) });
    if (one.ok) ok++;
    else failed.push({ id: r[spec.pk], error: (await one.text()).slice(0, 200) });
  }
  return { ok, failed };
}

async function supabaseCount(table) {
  const res = await sb(`${table}?select=*`, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
  return Number((res.headers.get('content-range') || '*/0').split('/')[1]);
}

async function main() {
  let fsdb = null;
  if (!FIXTURE) {
    if (!process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT) throw new Error('Env FIREBASE_ADMIN_SERVICE_ACCOUNT belum di-set');
    const admin = (await import('firebase-admin')).default;
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT)) });
    fsdb = admin.firestore();
  }
  if (APPLY) {
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (!process.env[k]) throw new Error(`Env ${k} belum di-set`);
  }
  console.log(APPLY ? '== MODE APPLY (menulis ke Supabase) ==' : '== MODE DRY-RUN (tidak menulis) ==');

  const selected = TABLES.filter((s) => !ONLY.length || ONLY.includes(s.c));
  const rowsBy = {};
  const rawCount = {};
  for (const spec of selected) {
    const docs = await readCollection(fsdb, spec.c);
    rawCount[spec.c] = docs.length;
    rowsBy[spec.c] = docs.map((d) => mapDoc(spec, d.id, d.data));
  }

  // Validasi memerlukan SEMUA koleksi induk; kalau --only dipakai, referensi
  // ke koleksi yang tidak dibaca tidak bisa dicek (dilewati).
  const problems = ONLY.length ? validateAll(rowsBy).filter((p) => p.kind !== 'FK_ORPHAN') : validateAll(rowsBy);
  const badKeys = new Set(problems.filter((p) => p.kind !== 'UNPARSED_VALUE').map((p) => `${p.c}/${p.id}`));
  for (const p of problems) console.error(`  ${p.kind} ${p.c}/${p.id}: ${p.detail}`);

  const report = [];
  let writeFailures = 0;
  for (const spec of selected) {
    const rows = rowsBy[spec.c];
    const writable = rows.filter((r) => !badKeys.has(`${spec.c}/${r[spec.pk]}`));
    let ok = 0;
    let failed = [];
    if (APPLY && (ALLOW_PROBLEMS || badKeys.size === 0)) {
      for (let i = 0; i < writable.length; i += BATCH) {
        const r = await upsert(spec, writable.slice(i, i + BATCH));
        ok += r.ok;
        failed = failed.concat(r.failed);
      }
    }
    writeFailures += failed.length;
    for (const f of failed) console.error(`  GAGAL TULIS ${spec.c}/${f.id}: ${f.error}`);
    report.push({
      koleksi: spec.c,
      firestore: rawCount[spec.c],
      bermasalah: rows.length - writable.length,
      ditulis: APPLY ? ok : '-',
      supabase: APPLY ? await supabaseCount(spec.c) : '-',
    });
  }
  console.table(report);

  if (APPLY && badKeys.size > 0 && !ALLOW_PROBLEMS) {
    console.error(`Ada ${badKeys.size} baris bermasalah — TIDAK ada yang ditulis. Perbaiki data sumber atau pakai --allow-problems.`);
    process.exit(1);
  }
  if (writeFailures > 0 || badKeys.size > 0) {
    console.error('Ada baris bermasalah/gagal. JANGAN cutover sebelum semua beres atau diputuskan manual.');
    process.exit(1);
  }
  console.log(APPLY ? 'Semua baris tertulis; jumlah Supabase >= Firestore.' : 'Dry-run bersih: tidak ada masalah. Siap --apply.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
