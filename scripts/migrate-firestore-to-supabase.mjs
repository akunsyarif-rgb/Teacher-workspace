#!/usr/bin/env node
/**
 * Salin data Firestore -> Supabase (proyek "Workflow"), AMAN untuk data produksi:
 *  - HANYA MEMBACA Firestore. Tidak pernah menulis/menghapus apa pun di sana.
 *  - Tidak pernah DELETE di Supabase; hanya upsert (merge by primary key) —
 *    aman dijalankan berulang kali (idempotent), mis. sekali sekarang lalu sekali
 *    lagi saat cutover untuk menyusul data baru.
 *  - Field Firestore yang tidak punya kolom khusus masuk ke kolom `metadata`
 *    (jsonb), jadi tidak ada data yang hilang.
 *  - Default DRY-RUN: cuma menghitung & memvalidasi. Tulis betulan dengan --apply.
 *
 * Env wajib:
 *   FIREBASE_ADMIN_SERVICE_ACCOUNT   JSON service account (satu baris)
 *   SUPABASE_URL                     https://htutgpjcynbnyxwgorcb.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY        service_role key (JANGAN di-commit / JANGAN ke client)
 *
 * Pakai:
 *   node scripts/migrate-firestore-to-supabase.mjs            # dry-run
 *   node scripts/migrate-firestore-to-supabase.mjs --apply    # tulis
 *   node scripts/migrate-firestore-to-supabase.mjs --apply --only=students,grades
 */
import admin from 'firebase-admin';

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const BATCH = 500;

// Urutan = urutan dependensi foreign key.
// pk: kolom primary key yang diisi dari ID dokumen Firestore.
const TABLES = [
  { c: 'workspaces', t: 'workspaces', pk: 'id',
    cols: ['owner_uid', 'name', 'invite_code', 'invite_code_expires_at', 'plan', 'class_limit', 'seat_limit', 'plan_expires_at'] },
  { c: 'teacher_profiles', t: 'teacher_profiles', pk: 'user_id',
    cols: ['workspace_id', 'role', 'homeroom_class_name', 'name', 'email'] },
  { c: 'workspace_invites', t: 'workspace_invites', pk: 'code', cols: ['workspace_id', 'expires_at'] },
  { c: 'payments', t: 'payments', pk: 'order_id',
    cols: ['workspace_id', 'status', 'amount', 'currency', 'uid', 'plan', 'seat_count', 'gross_amount', 'settled_at'] },
  { c: 'students', t: 'students', pk: 'id',
    cols: ['workspace_id', 'class_name', 'name', 'nis', 'nisn', 'gender', 'access_code'] },
  { c: 'student_profiles', t: 'student_profiles', pk: 'user_id',
    cols: ['workspace_id', 'student_id', 'class_name', 'name', 'nis'] },
  { c: 'student_login_codes', t: 'student_login_codes', pk: 'id',
    cols: ['workspace_id', 'student_id', 'class_name', 'code', 'used_at', 'name', 'nis'] },
  { c: 'academic_years', t: 'academic_years', pk: 'id',
    cols: ['workspace_id', 'label', 'start_date', 'end_date', 'is_active'] },
  { c: 'schedules', t: 'schedules', pk: 'id',
    cols: ['workspace_id', 'class_name', 'date', 'day', 'time_slot', 'subject', 'teacher_name'] },
  { c: 'journals', t: 'journals', pk: 'id', cols: ['workspace_id', 'class_name', 'date', 'teacher_uid', 'subject'] },
  { c: 'attendances', t: 'attendances', pk: 'id', cols: ['workspace_id', 'class_name', 'student_id', 'date', 'status'] },
  { c: 'grade_columns', t: 'grade_columns', pk: 'id',
    cols: ['workspace_id', 'class_name', 'name', 'weight', 'title', 'type'] },
  { c: 'grades', t: 'grades', pk: 'id', cols: ['workspace_id', 'class_name', 'student_id', 'column_id', 'score'] },
  { c: 'class_fund_transactions', t: 'class_fund_transactions', pk: 'id',
    cols: ['workspace_id', 'class_name', 'student_id', 'transaction_date', 'amount', 'type'] },
  { c: 'class_inventory', t: 'class_inventory', pk: 'id',
    cols: ['workspace_id', 'class_name', 'name', 'quantity', 'unit'] },
  { c: 'student_notes', t: 'student_notes', pk: 'id',
    cols: ['workspace_id', 'class_name', 'student_id', 'teacher_uid', 'note', 'category'] },
  { c: 'assignments', t: 'assignments', pk: 'id',
    cols: ['workspace_id', 'class_name', 'teacher_uid', 'title', 'description', 'due_date', 'subject',
      'grade_column_id', 'material_file_url', 'material_file_name', 'material_file_path'] },
  { c: 'submissions', t: 'submissions', pk: 'id',
    cols: ['workspace_id', 'class_name', 'assignment_id', 'student_id', 'submitted_at', 'status', 'score',
      'feedback', 'text_answer', 'external_link', 'attachments'] },
  { c: 'announcements', t: 'announcements', pk: 'id',
    cols: ['workspace_id', 'class_name', 'teacher_uid', 'title', 'body', 'date'] },
  { c: 'student_achievements', t: 'student_achievements', pk: 'id',
    cols: ['workspace_id', 'class_name', 'student_id', 'title', 'description', 'date'] },
  { c: 'session_skip_reasons', t: 'session_skip_reasons', pk: 'id',
    cols: ['workspace_id', 'class_name', 'teacher_uid', 'date', 'reason'] },
];

const TIMESTAMPTZ = new Set(['created_at', 'updated_at', 'used_at', 'submitted_at']);
const BIGINT_MS = new Set(['invite_code_expires_at', 'plan_expires_at', 'expires_at', 'settled_at']);
const DATE_COLS = new Set(['date', 'due_date', 'transaction_date', 'start_date', 'end_date']);

const snake = (k) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const isTs = (v) => v && typeof v === 'object' && typeof v.toDate === 'function';

function plain(v) {
  if (isTs(v)) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

function coerce(col, v) {
  if (v === undefined) return null;
  if (TIMESTAMPTZ.has(col)) return isTs(v) ? v.toDate().toISOString() : v;
  if (BIGINT_MS.has(col)) return isTs(v) ? v.toMillis() : v;
  if (DATE_COLS.has(col)) return isTs(v) ? v.toDate().toISOString().slice(0, 10) : v;
  return plain(v);
}

function mapDoc(spec, id, data) {
  const known = new Set([...spec.cols, 'created_at', 'updated_at']);
  const row = { [spec.pk]: id };
  const metadata = {};
  for (const [k, v] of Object.entries(data)) {
    const col = snake(k);
    if (col === spec.pk && col !== 'id') continue; // sudah dari ID dokumen
    if (known.has(col)) row[col] = coerce(col, v);
    else metadata[k] = plain(v);
  }
  for (const c of spec.cols) if (!(c in row)) row[c] = null;
  row.metadata = metadata;
  if (!row.created_at) delete row.created_at; // pakai default now()
  if (!row.updated_at) delete row.updated_at;
  return row;
}

async function sb(path, init = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return res;
}

async function upsert(spec, rows) {
  const res = await sb(`${spec.t}?on_conflict=${spec.pk}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (res.ok) return { ok: rows.length, failed: [] };
  // Batch gagal (mis. 1 baris melanggar FK/NOT NULL) -> coba per baris supaya
  // baris sehat tetap masuk dan baris bermasalah terlapor jelas.
  let ok = 0;
  const failed = [];
  for (const r of rows) {
    const one = await sb(`${spec.t}?on_conflict=${spec.pk}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([r]),
    });
    if (one.ok) ok++;
    else failed.push({ id: r[spec.pk], error: (await one.text()).slice(0, 200) });
  }
  return { ok, failed };
}

async function supabaseCount(table) {
  const res = await sb(`${table}?select=*`, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
  const range = res.headers.get('content-range') || '*/0';
  return Number(range.split('/')[1]);
}

async function main() {
  for (const k of ['FIREBASE_ADMIN_SERVICE_ACCOUNT', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!process.env[k]) throw new Error(`Env ${k} belum di-set`);
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT)) });
  const fs = admin.firestore();

  console.log(APPLY ? '== MODE APPLY (menulis ke Supabase) ==' : '== MODE DRY-RUN (tidak menulis) ==');
  const report = [];
  for (const spec of TABLES) {
    if (ONLY.length && !ONLY.includes(spec.c)) continue;
    const snap = await fs.collection(spec.c).get();
    const rows = snap.docs.map((d) => mapDoc(spec, d.id, d.data()));
    let ok = 0;
    let failed = [];
    if (APPLY) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const r = await upsert(spec, rows.slice(i, i + BATCH));
        ok += r.ok;
        failed = failed.concat(r.failed);
      }
    }
    const inSupabase = APPLY ? await supabaseCount(spec.t) : null;
    report.push({ koleksi: spec.c, firestore: rows.length, ditulis: APPLY ? ok : '-', gagal: failed.length, supabase: inSupabase ?? '-' });
    for (const f of failed) console.error(`  GAGAL ${spec.c}/${f.id}: ${f.error}`);
  }
  console.table(report);
  const bad = report.some((r) => r.gagal > 0 || (APPLY && r.supabase < r.firestore));
  if (bad) {
    console.error('Ada baris gagal / jumlah belum sama. JANGAN cutover sebelum beres.');
    process.exit(1);
  }
  console.log(APPLY ? 'Semua jumlah cocok.' : 'Dry-run selesai. Jalankan ulang dengan --apply.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
