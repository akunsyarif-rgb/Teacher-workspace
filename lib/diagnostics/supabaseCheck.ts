import { createSupabaseTokenProvider, type RoleClaimUser } from '../adapters/firebaseRoleClaim';
import { decodeJwtClaims, hasAuthenticatedRole } from '../utils/jwtClaims';

// Uji konfigurasi Firebase → Supabase dari BROWSER (iPad) terhadap layanan nyata. Hanya BACA (GET + RPC read-only);
// satu-satunya efek samping: memasang claim role pada akun yang sedang diuji (bila ENABLE_SUPABASE_CLAIM=yes di server).
// Token TIDAK PERNAH ditampilkan/dikembalikan — hasil hanya status dan penjelasan.
export type DiagStatus = 'pass' | 'fail' | 'info';
export interface DiagResult { id: string; label: string; status: DiagStatus; detail: string }

export interface DiagDeps {
  getUser: () => (RoleClaimUser & { uid: string }) | null;
  env: { url?: string; publishableKey?: string };
  fetchImpl?: typeof fetch;
  claimEndpoint?: string;
}

const SMADA_REF = 'abdkrhmxfpcmgzsxzfyz';

export async function runSupabaseDiagnostics(deps: DiagDeps): Promise<DiagResult[]> {
  const out: DiagResult[] = [];
  const add = (id: string, label: string, status: DiagStatus, detail: string) => out.push({ id, label, status, detail });
  const doFetch = deps.fetchImpl ?? fetch;

  const base = String(deps.env.url ?? '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const ref = base.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  const key = deps.env.publishableKey;
  if (!ref || !key) {
    add('config', 'Konfigurasi publik Supabase', 'fail', 'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY belum diisi di Vercel (lalu Redeploy).');
    return out;
  }
  if (ref === SMADA_REF) {
    add('config', 'Konfigurasi publik Supabase', 'fail', 'URL menunjuk project yang salah (bukan Workflow). Hentikan.');
    return out;
  }
  add('config', 'Konfigurasi publik Supabase', 'pass', `project ${ref}`);

  const user = deps.getUser();
  if (!user) {
    add('session', 'Sesi Firebase', 'fail', 'Belum ada sesi. Masuk sebagai guru, atau gunakan tombol uji siswa anonim.');
    return out;
  }
  let raw: string;
  try {
    raw = await user.getIdToken();
    const c = decodeJwtClaims(raw) as { firebase?: { sign_in_provider?: string }; aud?: string; iss?: string };
    const provider = c.firebase?.sign_in_provider ?? '?';
    add('session', 'Sesi Firebase', 'pass', `jenis akun: ${provider === 'anonymous' ? 'siswa anonim' : 'guru (' + provider + ')'}; proyek Firebase: ${c.aud ?? '?'}`);
  } catch (e) {
    add('session', 'Sesi Firebase', 'fail', `Token tidak terbaca: ${e instanceof Error ? e.message : e}`);
    return out;
  }

  // Claim role
  let token: string | null = null;
  if (hasAuthenticatedRole(raw)) {
    token = raw;
    add('claim', 'Claim role = "authenticated"', 'pass', 'sudah ada di token');
  } else {
    try {
      token = await createSupabaseTokenProvider({ getUser: () => user, fetchImpl: doFetch, endpoint: deps.claimEndpoint })();
      add('claim', 'Claim role = "authenticated"', 'pass', 'dipasang server lalu token diperbarui');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Pesan server (501) sudah memuat penyebab dan identitas deployment; tambahkan petunjuk tindakan singkat.
      add('claim', 'Claim role = "authenticated"', 'fail', /501|belum diaktifkan/i.test(msg)
        ? `Server belum mengaktifkan pemasang claim. ${msg} → Isi ENABLE_SUPABASE_CLAIM=yes (Preview), lalu Redeploy.`
        : msg);
    }
  }

  const call = async (path: string, bearer: string | null, init: RequestInit = {}) => {
    const res = await doFetch(`${base}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${bearer ?? key}`, 'Content-Type': 'application/json' },
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  };
  const errText = (b: unknown) => (b && typeof b === 'object' ? String((b as { message?: string }).message ?? '') : String(b ?? '')).slice(0, 160);

  // Kontrol anonim: tanpa token pengguna tidak boleh ada data
  {
    const r = await call('teacher_profiles?select=user_id&limit=1', null);
    const leaked = r.status === 200 && Array.isArray(r.body) && r.body.length > 0;
    add('anon', 'Tanpa login: tidak ada akses data', leaked ? 'fail' : 'pass', leaked ? 'DATA TERBACA TANPA LOGIN — hentikan, hubungi pengembang.' : `HTTP ${r.status} (ditolak/kosong)`);
  }

  if (!token) return out;

  // Token diterima Supabase?
  const accepted = await call('teacher_profiles?select=user_id&limit=1', token);
  if (accepted.status === 200) {
    add('accepted', 'Supabase menerima token', 'pass', 'Third-Party Auth Firebase aktif dan role terbaca');
  } else if (accepted.status === 401) {
    const m = errText(accepted.body);
    add('accepted', 'Supabase menerima token', 'fail', /role/i.test(m)
      ? `Claim role tidak dikenali (${m}).`
      : `Ditolak (${m}). Periksa Supabase → Authentication → Third-Party Auth → Firebase: Project ID harus sama dengan proyek Firebase di atas.`);
    return out;
  } else {
    add('accepted', 'Supabase menerima token', 'fail', `HTTP ${accepted.status}: ${errText(accepted.body)}`);
    return out;
  }

  // Identitas (auth_probe) — butuh migrasi 20261009000100
  const probe = await call('rpc/auth_probe', token, { method: 'POST', body: '{}' });
  if (probe.status === 200 && probe.body && typeof probe.body === 'object') {
    const p = probe.body as { role?: string; uid?: string; sub?: string };
    const sub = String((decodeJwtClaims(token) as { sub?: string }).sub ?? '');
    add('identity', 'Identitas terpetakan (sub = uid Firebase)', p.uid === sub && p.role === 'authenticated' ? 'pass' : 'fail',
      p.uid === sub ? `role=${p.role}, uid cocok dengan akun Firebase` : 'uid di Supabase tidak sama dengan uid Firebase');
  } else {
    add('identity', 'Identitas terpetakan (sub = uid Firebase)', 'info', 'Fungsi auth_probe belum dipasang (migrasi 20261009000100). Lewati atau setujui penerapan migrasi.');
  }

  // Isolasi RLS: pengguna baru tanpa workspace tidak boleh melihat data tenant
  for (const table of ['workspaces', 'students', 'student_login_codes', 'submissions', 'journals']) {
    const r = await call(`${table}?select=id&limit=5`, token);
    const n = Array.isArray(r.body) ? r.body.length : -1;
    add(`rls-${table}`, `RLS ${table}`, r.status === 200 ? 'info' : 'fail', r.status === 200 ? `${n} baris terlihat oleh akun ini` : `HTTP ${r.status}: ${errText(r.body)}`);
  }
  return out;
}
