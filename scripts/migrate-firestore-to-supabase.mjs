import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const workspaceArg = process.argv.find((arg) => arg.startsWith('--workspace='));
const WORKSPACE_FILTER = workspaceArg ? workspaceArg.slice('--workspace='.length) : null;

if (!FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT is required.');
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');

if (!getApps().length) initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

const TABLE_COLUMNS = {
  announcements:['id','workspace_id','class_name','teacher_uid','title','body','date','metadata','created_at','updated_at'],
  assignments:['id','workspace_id','class_name','teacher_uid','title','description','due_date','subject','metadata','created_at','updated_at','grade_column_id','material_file_url','material_file_name','material_file_path'],
  attendances:['id','workspace_id','class_name','student_id','date','status','metadata','created_at','updated_at'],
  class_fund_transactions:['id','workspace_id','class_name','student_id','transaction_date','amount','type','metadata','created_at','updated_at'],
  class_inventory:['id','workspace_id','class_name','name','quantity','unit','metadata','created_at','updated_at'],
  grade_columns:['id','workspace_id','class_name','name','weight','metadata','created_at','updated_at','title','type'],
  grades:['id','workspace_id','class_name','student_id','column_id','score','metadata','created_at','updated_at'],
  journals:['id','workspace_id','class_name','date','teacher_uid','subject','metadata','created_at','updated_at'],
  payments:['order_id','workspace_id','status','amount','currency','metadata','created_at','updated_at','uid','plan','seat_count','gross_amount','settled_at'],
  schedules:['id','workspace_id','class_name','date','day','time_slot','subject','teacher_name','metadata','created_at','updated_at'],
  session_skip_reasons:['id','workspace_id','class_name','teacher_uid','date','reason','metadata','created_at','updated_at'],
  student_achievements:['id','workspace_id','class_name','student_id','title','description','date','metadata','created_at','updated_at'],
  student_login_codes:['id','workspace_id','student_id','class_name','code','used_at','metadata','created_at','updated_at','name','nis'],
  student_notes:['id','workspace_id','class_name','student_id','teacher_uid','note','metadata','created_at','updated_at','category'],
  student_profiles:['user_id','workspace_id','student_id','class_name','name','nis','metadata','created_at','updated_at'],
  students:['id','workspace_id','class_name','name','nis','nisn','gender','access_code','metadata','created_at','updated_at'],
  submissions:['id','workspace_id','class_name','assignment_id','student_id','submitted_at','status','score','feedback','text_answer','external_link','attachments','metadata','created_at','updated_at'],
  teacher_profiles:['user_id','workspace_id','role','homeroom_class_name','name','email','metadata','created_at','updated_at'],
  workspace_invites:['code','workspace_id','expires_at','metadata','created_at','updated_at'],
  workspaces:['id','owner_uid','name','invite_code','invite_code_expires_at','plan','class_limit','seat_limit','plan_expires_at','metadata','created_at','updated_at'],
};

const COLLECTIONS = Object.keys(TABLE_COLUMNS);
const PRIMARY_KEY = { teacher_profiles:'user_id', student_profiles:'user_id', workspace_invites:'code', payments:'order_id' };
const camelToSnake = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

function normalize(value) {
  if (value == null) return value;
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value?._seconds !== undefined && value?._nanoseconds !== undefined) return new Date(value._seconds * 1000 + Math.floor(value._nanoseconds / 1e6)).toISOString();
  if (value?._lat !== undefined && value?._long !== undefined) return { lat:value._lat, lng:value._long };
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,normalize(v)]));
  return value;
}

function transform(table, doc) {
  const allowed = new Set(TABLE_COLUMNS[table]);
  const data = normalize(doc.data());
  const id = doc.id;
  const row = {};
  const metadata = { ...(data.metadata || {}) };

  for (const [camelKey, value] of Object.entries(data)) {
    const column = camelToSnake(camelKey);
    if (allowed.has(column) && column !== 'metadata') row[column] = value;
    else if (!allowed.has(column) && camelKey !== 'metadata') metadata[camelKey] = value;
  }

  const pk = PRIMARY_KEY[table] || 'id';
  row[pk] = id;
  if (table === 'student_login_codes') row.code = row.code || id;
  if (allowed.has('metadata') && Object.keys(metadata).length) row.metadata = metadata;

  if (WORKSPACE_FILTER && row.workspace_id !== WORKSPACE_FILTER) return null;
  return row;
}

async function supabaseUpsert(table, rows) {
  if (!rows.length || DRY_RUN) return;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:'POST',
    headers:{ apikey:SUPABASE_SECRET_KEY, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
    body:JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
}

async function migrateCollection(table) {
  const snapshot = await db.collection(table).get();
  const rows = snapshot.docs.map((doc) => transform(table,doc)).filter(Boolean);
  for (let i=0;i<rows.length;i+=100) await supabaseUpsert(table,rows.slice(i,i+100));
  console.log(`${table}: ${rows.length} documents${DRY_RUN ? ' (dry-run)' : ''}`);
  return rows.length;
}

let total = 0;
for (const table of COLLECTIONS) total += await migrateCollection(table);
console.log(`Done. ${total} documents processed. ${DRY_RUN ? 'No writes were made.' : 'Existing Supabase rows were upserted; nothing was deleted.'}`);
