// Logika murni (tanpa I/O) untuk migrasi Firestore -> Supabase: pemetaan
// dokumen -> baris & validasi offline. Dipisah dari runner supaya bisa diuji
// tanpa Firestore/Supabase (lihat tests/migration-mapping.test.ts).

// Urutan = urutan dependensi foreign key.
// pk: kolom primary key yang diisi dari ID dokumen Firestore.
// required: kolom NOT NULL. refs: kolom FK -> tabel tujuan.
// unique: constraint unik gabungan selain primary key.
export const TABLES = [
  { c: 'workspaces', pk: 'id', required: ['owner_uid'],
    cols: ['owner_uid', 'name', 'invite_code', 'invite_code_expires_at', 'plan', 'class_limit', 'seat_limit', 'plan_expires_at'] },
  { c: 'teacher_profiles', pk: 'user_id', required: [], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'role', 'homeroom_class_name', 'name', 'email'] },
  { c: 'workspace_invites', pk: 'code', required: ['workspace_id'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'expires_at'] },
  { c: 'payments', pk: 'order_id', required: ['workspace_id'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'status', 'amount', 'currency', 'uid', 'plan', 'seat_count', 'gross_amount', 'settled_at'] },
  { c: 'students', pk: 'id', required: ['workspace_id', 'class_name'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'class_name', 'name', 'nis', 'nisn', 'gender', 'access_code'] },
  { c: 'student_profiles', pk: 'user_id', required: ['workspace_id', 'student_id', 'class_name'],
    refs: { workspace_id: 'workspaces', student_id: 'students' },
    cols: ['workspace_id', 'student_id', 'class_name', 'name', 'nis'] },
  { c: 'student_login_codes', pk: 'id', required: ['workspace_id', 'student_id', 'class_name', 'code'],
    refs: { workspace_id: 'workspaces', student_id: 'students' }, unique: [['workspace_id', 'code']],
    cols: ['workspace_id', 'student_id', 'class_name', 'code', 'used_at', 'name', 'nis'] },
  { c: 'academic_years', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'label', 'start_date', 'end_date', 'is_active'] },
  { c: 'schedules', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'class_name', 'date', 'day', 'time_slot', 'subject', 'teacher_name'] },
  { c: 'journals', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'class_name', 'date', 'teacher_uid', 'subject'] },
  { c: 'attendances', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces', student_id: 'students' },
    cols: ['workspace_id', 'class_name', 'student_id', 'date', 'status'] },
  { c: 'grade_columns', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'class_name', 'name', 'weight', 'title', 'type'] },
  { c: 'grades', pk: 'id', required: ['workspace_id'],
    refs: { workspace_id: 'workspaces', student_id: 'students', column_id: 'grade_columns' },
    unique: [['workspace_id', 'student_id', 'column_id']],
    cols: ['workspace_id', 'class_name', 'student_id', 'column_id', 'score'] },
  { c: 'class_fund_transactions', pk: 'id', required: ['workspace_id', 'class_name'],
    refs: { workspace_id: 'workspaces', student_id: 'students' },
    cols: ['workspace_id', 'class_name', 'student_id', 'transaction_date', 'amount', 'type'] },
  { c: 'class_inventory', pk: 'id', required: ['workspace_id', 'class_name'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'class_name', 'name', 'quantity', 'unit'] },
  { c: 'student_notes', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces', student_id: 'students' },
    cols: ['workspace_id', 'class_name', 'student_id', 'teacher_uid', 'note', 'category'] },
  { c: 'assignments', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'class_name', 'teacher_uid', 'title', 'description', 'due_date', 'subject',
      'grade_column_id', 'material_file_url', 'material_file_name', 'material_file_path'] },
  { c: 'submissions', pk: 'id', required: ['workspace_id', 'assignment_id', 'student_id'],
    refs: { workspace_id: 'workspaces', assignment_id: 'assignments', student_id: 'students' },
    unique: [['assignment_id', 'student_id']],
    cols: ['workspace_id', 'class_name', 'assignment_id', 'student_id', 'submitted_at', 'status', 'score',
      'feedback', 'text_answer', 'external_link', 'attachments'] },
  { c: 'announcements', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'class_name', 'teacher_uid', 'title', 'body', 'date'] },
  { c: 'student_achievements', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces', student_id: 'students' },
    cols: ['workspace_id', 'class_name', 'student_id', 'title', 'description', 'date'] },
  { c: 'session_skip_reasons', pk: 'id', required: ['workspace_id'], refs: { workspace_id: 'workspaces' },
    cols: ['workspace_id', 'class_name', 'teacher_uid', 'date', 'reason'] },
];

const TIMESTAMPTZ = new Set(['created_at', 'updated_at', 'used_at', 'submitted_at']);
const BIGINT_MS = new Set(['invite_code_expires_at', 'plan_expires_at', 'expires_at', 'settled_at']);
const DATE_COLS = new Set(['date', 'due_date', 'transaction_date', 'start_date', 'end_date']);
const NUMERIC = new Set(['weight', 'score', 'amount', 'quantity', 'gross_amount']);
const INTEGER = new Set(['seat_count', 'class_limit', 'seat_limit']);
const BOOLEAN = new Set(['is_active']);
const JSON_COLS = new Set(['external_link', 'attachments']);

const snake = (k) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());

// Firestore Timestamp (SDK admin/client) ATAU hasil serialisasi JSON-nya.
function toDateObj(v) {
  if (v && typeof v === 'object') {
    if (typeof v.toDate === 'function') return v.toDate();
    const s = v._seconds ?? v.seconds;
    if (typeof s === 'number') return new Date(s * 1000 + Math.floor((v._nanoseconds ?? v.nanoseconds ?? 0) / 1e6));
  }
  return null;
}

// Tanggal dinding WITA — sama dengan lib/utils/witaDate.ts, bukan tanggal UTC.
const witaFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' });

export function plain(v) {
  const d = toDateObj(v);
  if (d) return d.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

const BAD = Symbol('bad');

// Kembalikan nilai yang cocok dengan tipe kolom, atau BAD kalau tidak bisa
// dikonversi tanpa kehilangan arti (nilai mentah lalu disimpan di metadata).
function coerce(col, v) {
  if (v === undefined || v === null) return null;
  const d = toDateObj(v);
  if (TIMESTAMPTZ.has(col)) {
    if (d) return d.toISOString();
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
    if (typeof v === 'number') return new Date(v).toISOString();
    return BAD;
  }
  if (BIGINT_MS.has(col)) {
    if (d) return d.getTime();
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.trunc(Number(v));
    return BAD;
  }
  if (DATE_COLS.has(col)) {
    if (d) return witaFmt.format(d);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) return v;
    if (v === '') return null;
    return BAD;
  }
  if (NUMERIC.has(col) || INTEGER.has(col)) {
    if (v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return BAD;
    return INTEGER.has(col) ? Math.trunc(n) : n;
  }
  if (BOOLEAN.has(col)) return typeof v === 'boolean' ? v : BAD;
  if (JSON_COLS.has(col)) return plain(v);
  return plain(v);
}

// Dokumen Firestore -> baris Supabase. Tidak ada field yang dibuang:
// yang tidak punya kolom masuk ke metadata; yang gagal dikonversi tipenya
// jadi NULL dan nilai aslinya disimpan di metadata.__unparsed.
export function mapDoc(spec, id, data) {
  const known = new Set([...spec.cols, 'created_at', 'updated_at']);
  const row = { [spec.pk]: id };
  const metadata = {};
  const unparsed = {};
  for (const [k, v] of Object.entries(data)) {
    const col = snake(k);
    if (col === spec.pk && col !== 'id') continue; // sudah dari ID dokumen
    if (known.has(col)) {
      const out = coerce(col, v);
      if (out === BAD) {
        row[col] = null;
        unparsed[k] = plain(v);
      } else row[col] = out;
    } else metadata[k] = plain(v);
  }
  for (const c of spec.cols) if (!(c in row)) row[c] = null;
  if ('is_active' in row && row.is_active === null) row.is_active = false; // kolom NOT NULL default false
  if (Object.keys(unparsed).length) metadata.__unparsed = unparsed;
  row.metadata = metadata;
  if (!row.created_at) delete row.created_at; // default now()
  if (!row.updated_at) delete row.updated_at;
  if (!('attachments' in row) || row.attachments === null) delete row.attachments; // default '[]'
  if (spec.c !== 'submissions') delete row.attachments;
  return row;
}

// Validasi offline terhadap constraint skema Supabase. Mengembalikan daftar
// masalah per koleksi; tidak ada yang dihapus/diubah.
export function validateAll(rowsByCollection) {
  const ids = {};
  for (const spec of TABLES) ids[spec.c] = new Set((rowsByCollection[spec.c] || []).map((r) => r[spec.pk]));
  const problems = [];
  for (const spec of TABLES) {
    const seen = new Map((spec.unique || []).map((u) => [u.join('+'), new Map()]));
    for (const row of rowsByCollection[spec.c] || []) {
      const rid = row[spec.pk];
      for (const col of spec.required) {
        if (row[col] === null || row[col] === undefined || row[col] === '') {
          problems.push({ c: spec.c, id: rid, kind: 'NOT_NULL', detail: col });
        }
      }
      for (const [col, target] of Object.entries(spec.refs || {})) {
        const ref = row[col];
        if (ref !== null && ref !== undefined && ref !== '' && !ids[target].has(ref)) {
          problems.push({ c: spec.c, id: rid, kind: 'FK_ORPHAN', detail: `${col} -> ${target}/${ref}` });
        }
      }
      for (const u of spec.unique || []) {
        const vals = u.map((c) => row[c]);
        if (vals.some((x) => x === null || x === undefined)) continue; // NULL tidak bentrok
        const key = vals.join('\u0000');
        const m = seen.get(u.join('+'));
        if (m.has(key)) problems.push({ c: spec.c, id: rid, kind: 'DUPLICATE', detail: `${u.join('+')} sama dengan ${m.get(key)}` });
        else m.set(key, rid);
      }
      if (row.metadata && row.metadata.__unparsed) {
        problems.push({ c: spec.c, id: rid, kind: 'UNPARSED_VALUE', detail: Object.keys(row.metadata.__unparsed).join(',') });
      }
    }
  }
  return problems;
}
