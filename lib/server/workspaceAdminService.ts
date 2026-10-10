import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from './firebaseAdmin';
import { isSeatLimitReached } from '../config/plans';
import { SupabaseServerError, identityOnSupabase, userRequest } from './supabaseServer';

const WORKSPACES_COLLECTION = 'workspaces';
const WORKSPACE_INVITES_COLLECTION = 'workspace_invites';
const TEACHER_PROFILES_COLLECTION = 'teacher_profiles';

type WorkspaceRecord = {
  id: string;
  name: string;
  plan: string;
  ownerUid: string;
  classLimit: number | null;
  seatLimit?: number | null;
  inviteCode?: string;
  inviteCodeExpiresAt?: number;
  [key: string]: unknown;
};

// Seluruh alur join-by-code dijalankan di sini lewat Admin SDK (bypass
// Firestore Rules), BUKAN direplikasi sebagai rule client baru. Kenapa:
// menegakkan kuota kursi guru (seatLimit) butuh menghitung berapa guru
// yang sudah ada di workspace tujuan — sebuah count/list query difilter
// workspaceId. Firestore TIDAK BISA mengevaluasi count/list semacam itu
// untuk guru yang baru mau join: pada titik itu mereka belum OWNER/ADMIN,
// belum py profil sendiri, belum py hubungan apa pun ke workspace tujuan
// — jadi tidak ada rule client-side yang realistis bisa memberi mereka
// izin list/count tanpa sekaligus membuka data anggota workspace (nama,
// mapel, quickNote, dst) ke siapa pun yang cuma menebak workspaceId.
// Dibuktikan langsung lewat reproduksi ke Firestore Emulator: count query
// ini gagal ("Null value error") bahkan untuk OWNER yang SUDAH py profil
// sendiri, karena rule teacher_profiles.allow read (self-read by document
// ID) secara struktural tidak kompatibel dengan operasi list/count di
// Firestore (path-ID equality tidak bisa dibuktikan per-kandidat untuk
// query yang tidak difilter by document ID). Ditemukan lewat
// tests/e2e/onboarding.mjs (backlog pasca-audit T1/T2) — join-by-code
// kemungkinan besar tidak pernah benar-benar berhasil di produksi untuk
// workspace dengan seatLimit terisi (yaitu SEMUA workspace sekolah baru).
export async function joinWorkspaceByCodeServer(uid: string, inviteCode: string, idToken?: string): Promise<WorkspaceRecord> {
  if (identityOnSupabase()) return joinWorkspaceSupabase(inviteCode, idToken);
  const adminDb = getAdminDb();

  const existingProfileSnap = await adminDb.collection(TEACHER_PROFILES_COLLECTION).doc(uid).get();
  if (existingProfileSnap.exists && existingProfileSnap.data()?.workspaceId) {
    throw new Error('Akun ini sudah terhubung ke sebuah Workspace. Satu akun hanya boleh memiliki satu Workspace.');
  }

  const trimmedCode = inviteCode.trim().toUpperCase();
  if (!trimmedCode) {
    throw new Error('Mohon masukkan kode undangan.');
  }

  const bridgeSnap = await adminDb.collection(WORKSPACE_INVITES_COLLECTION).doc(trimmedCode).get();
  const workspaceId = bridgeSnap.exists ? (bridgeSnap.data() as { workspaceId?: string }).workspaceId : null;
  if (!workspaceId) {
    throw new Error('Kode undangan tidak ditemukan.');
  }

  const workspaceSnap = await adminDb.collection(WORKSPACES_COLLECTION).doc(workspaceId).get();
  if (!workspaceSnap.exists) {
    throw new Error('Kode undangan tidak ditemukan.');
  }
  const workspace = { id: workspaceSnap.id, ...workspaceSnap.data() } as WorkspaceRecord;

  // Kode yang sudah diganti (regenerateInviteCode) tetap ditolak lewat
  // pengecekan ini — bekas jembatan lama boleh tetap ada, tapi tidak lagi
  // cocok dengan kode aktif workspace-nya. Sama seperti findWorkspaceByInviteCode
  // di workspaceRepository.ts (client), cuma dijalankan Admin SDK di sini.
  if (workspace.inviteCode !== trimmedCode) {
    throw new Error('Kode undangan tidak ditemukan.');
  }
  if (workspace.inviteCodeExpiresAt && workspace.inviteCodeExpiresAt < Date.now()) {
    throw new Error('Kode undangan sudah kedaluwarsa. Minta admin sekolah membuat kode baru.');
  }

  // Admin SDK bypass rules, jadi count query ini aman dijalankan di sini —
  // tidak perlu rule list/count baru di firestore.rules sama sekali.
  const memberCountSnap = await adminDb
    .collection(TEACHER_PROFILES_COLLECTION)
    .where('workspaceId', '==', workspaceId)
    .count()
    .get();
  const memberCount = memberCountSnap.data().count;
  if (isSeatLimitReached(workspace, memberCount)) {
    throw new Error(
      `Kuota guru workspace ini sudah penuh (maks ${workspace.seatLimit} guru). Hubungi pemilik aplikasi untuk menambah kuota guru.`
    );
  }

  await adminDb
    .collection(TEACHER_PROFILES_COLLECTION)
    .doc(uid)
    .set({ workspaceId, role: 'TEACHER', isActive: true }, { merge: true });

  return workspace;
}

// ---------------------------------------------------------------------------
// Jalur Supabase (flag identitas aktif): logika kuota/kedaluwarsa/satu-akun-satu-workspace ada di RPC
// public.join_workspace_by_code (SECURITY DEFINER, mengunci baris workspace; teruji di tests/rls). Dipanggil
// dengan token pengguna yang sudah diverifikasi Firebase Admin — bukan secret key.
// ---------------------------------------------------------------------------
function mapSupabaseJoinError(e: unknown): Error {
  const m = e instanceof SupabaseServerError ? e.message : '';
  if (/invalid invite code/i.test(m)) return new Error('Kode undangan tidak ditemukan.');
  if (/expired/i.test(m)) return new Error('Kode undangan sudah kedaluwarsa. Minta admin sekolah membuat kode baru.');
  if (/already belongs/i.test(m)) return new Error('Akun ini sudah terhubung ke sebuah Workspace. Satu akun hanya boleh memiliki satu Workspace.');
  if (/seat limit/i.test(m)) return new Error('Kuota guru workspace ini sudah penuh. Hubungi pemilik aplikasi untuk menambah kuota guru.');
  return e instanceof Error ? e : new Error('Gagal bergabung ke workspace.');
}

function workspaceFromRow(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    plan: String(row.plan ?? ''),
    ownerUid: String(row.owner_uid ?? ''),
    classLimit: (row.class_limit as number | null) ?? null,
    seatLimit: (row.seat_limit as number | null) ?? null,
    inviteCode: (row.invite_code as string | undefined) ?? undefined,
    inviteCodeExpiresAt: (row.invite_code_expires_at as number | undefined) ?? undefined,
  };
}

async function joinWorkspaceSupabase(inviteCode: string, idToken?: string): Promise<WorkspaceRecord> {
  const code = inviteCode.trim().toUpperCase();
  if (!code) throw new Error('Mohon masukkan kode undangan.');
  if (!idToken) throw new Error('Token otentikasi diperlukan.');
  try {
    const rows = (await userRequest(idToken, 'rpc/join_workspace_by_code', { method: 'POST', body: JSON.stringify({ p_code: code }) })) as { workspace_id: string }[];
    const wsId = rows?.[0]?.workspace_id;
    if (!wsId) throw new Error('Respons bergabung tidak lengkap dari server.');
    const ws = (await userRequest(idToken, `workspaces?id=eq.${encodeURIComponent(wsId)}&select=*`)) as Record<string, unknown>[];
    if (!ws[0]) throw new Error('Workspace tidak ditemukan setelah bergabung.');
    return workspaceFromRow(ws[0]);
  } catch (e) {
    throw mapSupabaseJoinError(e);
  }
}

// ---------------------------------------------------------------------------
// Menu Admin (hanya OWNER). teacher_profiles sengaja hanya bisa dibaca
// pemiliknya sendiri di firestore.rules, jadi daftar anggota dan pengeluaran
// anggota HARUS lewat Admin SDK di sini — izin dicek ulang di server, tidak
// pernah dipercaya dari klien.
// ---------------------------------------------------------------------------

export type WorkspaceMember = {
  uid: string;
  name: string;
  subject: string;
  email: string | null;
  role: string;
  isYou: boolean;
};

export class WorkspaceAdminError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requireOwner(uid: string) {
  const adminDb = getAdminDb();
  const profileSnap = await adminDb.collection(TEACHER_PROFILES_COLLECTION).doc(uid).get();
  const profile = profileSnap.data() as { workspaceId?: string; role?: string } | undefined;
  if (!profileSnap.exists || !profile?.workspaceId || profile.role !== 'OWNER') {
    throw new WorkspaceAdminError('Hanya pemilik workspace yang boleh membuka menu admin.', 403);
  }
  const workspaceSnap = await adminDb.collection(WORKSPACES_COLLECTION).doc(profile.workspaceId).get();
  if (!workspaceSnap.exists || workspaceSnap.data()?.ownerUid !== uid) {
    throw new WorkspaceAdminError('Hanya pemilik workspace yang boleh membuka menu admin.', 403);
  }
  return { adminDb, workspaceId: profile.workspaceId, workspace: { id: workspaceSnap.id, ...workspaceSnap.data() } as WorkspaceRecord };
}

// Pemeriksaan pemilik di Supabase (token pengguna → RLS): profil sendiri berperan OWNER + workspace-nya memang milik uid ini.
async function requireOwnerSupabase(uid: string, idToken?: string) {
  if (!idToken) throw new WorkspaceAdminError('Token otentikasi diperlukan.', 401);
  const profiles = (await userRequest(idToken, `teacher_profiles?user_id=eq.${encodeURIComponent(uid)}&select=workspace_id,role`)) as { workspace_id: string | null; role: string | null }[];
  const profile = profiles[0];
  if (!profile?.workspace_id || profile.role !== 'OWNER') throw new WorkspaceAdminError('Hanya pemilik workspace yang boleh membuka menu admin.', 403);
  const ws = (await userRequest(idToken, `workspaces?id=eq.${encodeURIComponent(profile.workspace_id)}&select=*`)) as Record<string, unknown>[];
  if (!ws[0] || ws[0].owner_uid !== uid) throw new WorkspaceAdminError('Hanya pemilik workspace yang boleh membuka menu admin.', 403);
  return { workspaceId: profile.workspace_id, workspace: workspaceFromRow(ws[0]) };
}

async function listMembersSupabase(uid: string, idToken?: string) {
  const { workspaceId, workspace } = await requireOwnerSupabase(uid, idToken);
  // Kolom dipilih eksplisit: quickNote dan field pribadi lain sengaja tidak ikut dikirim.
  const rows = (await userRequest(idToken as string, `teacher_profiles?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=user_id,name,role,subject:metadata->>subject&order=user_id`)) as
    { user_id: string; name: string | null; role: string | null; subject: string | null }[];
  const emailByUid = new Map<string, string>();
  if (rows.length > 0) {
    try {
      const result = await getAdminAuth().getUsers(rows.slice(0, 100).map((r) => ({ uid: r.user_id })));
      result.users.forEach((u) => { if (u.email) emailByUid.set(u.uid, u.email); });
    } catch (error) {
      console.error('Gagal memuat email anggota:', error instanceof Error ? error.message : error);
    }
  }
  const members: WorkspaceMember[] = rows.map((r) => ({
    uid: r.user_id, name: r.name || 'Tanpa nama', subject: r.subject || '', email: emailByUid.get(r.user_id) ?? null, role: r.role || 'TEACHER', isYou: r.user_id === uid,
  }));
  members.sort((a, b) => (a.role === 'OWNER' ? -1 : b.role === 'OWNER' ? 1 : a.name.localeCompare(b.name)));
  return { members, seatLimit: workspace.seatLimit ?? null };
}

async function removeMemberSupabase(uid: string, targetUid: string, idToken?: string) {
  await requireOwnerSupabase(uid, idToken);
  if (!targetUid || typeof targetUid !== 'string') throw new WorkspaceAdminError('Guru yang dikeluarkan tidak valid.', 400);
  try {
    await userRequest(idToken as string, 'rpc/remove_workspace_member', { method: 'POST', body: JSON.stringify({ p_target: targetUid }) });
  } catch (e) {
    const m = e instanceof SupabaseServerError ? e.message : '';
    if (/owner cannot remove self/i.test(m)) throw new WorkspaceAdminError('Pemilik tidak bisa mengeluarkan dirinya sendiri.', 400);
    if (/owner cannot be removed/i.test(m)) throw new WorkspaceAdminError('Pemilik workspace tidak bisa dikeluarkan.', 400);
    if (/member not found/i.test(m)) throw new WorkspaceAdminError('Guru tidak ditemukan di workspace ini.', 404);
    if (/only the workspace owner/i.test(m)) throw new WorkspaceAdminError('Hanya pemilik workspace yang boleh membuka menu admin.', 403);
    throw e;
  }
}

export async function listWorkspaceMembersServer(uid: string, idToken?: string) {
  if (identityOnSupabase()) return listMembersSupabase(uid, idToken);
  const { adminDb, workspaceId, workspace } = await requireOwner(uid);
  const snap = await adminDb.collection(TEACHER_PROFILES_COLLECTION).where('workspaceId', '==', workspaceId).get();

  const emailByUid = new Map<string, string>();
  if (snap.docs.length > 0) {
    try {
      const result = await getAdminAuth().getUsers(snap.docs.slice(0, 100).map((d) => ({ uid: d.id })));
      result.users.forEach((u) => {
        if (u.email) emailByUid.set(u.uid, u.email);
      });
    } catch (error) {
      console.error('Gagal memuat email anggota:', error instanceof Error ? error.message : error);
    }
  }

  // quickNote dan field pribadi lain sengaja tidak ikut dikirim.
  const members: WorkspaceMember[] = snap.docs.map((d) => {
    const data = d.data() as { name?: string; subject?: string; role?: string };
    return {
      uid: d.id,
      name: data.name || 'Tanpa nama',
      subject: data.subject || '',
      email: emailByUid.get(d.id) ?? null,
      role: data.role || 'TEACHER',
      isYou: d.id === uid,
    };
  });
  members.sort((a, b) => (a.role === 'OWNER' ? -1 : b.role === 'OWNER' ? 1 : a.name.localeCompare(b.name)));

  return { members, seatLimit: workspace.seatLimit ?? null };
}

// Mengeluarkan guru = melepas profilnya dari workspace (bukan menghapus akun
// Firebase-nya, dan data yang sudah ia buat tetap di workspace). Setelah itu
// ia bisa bergabung lagi lewat kode undangan.
export async function removeWorkspaceMemberServer(uid: string, targetUid: string, idToken?: string) {
  if (identityOnSupabase()) return removeMemberSupabase(uid, targetUid, idToken);
  const { adminDb, workspaceId } = await requireOwner(uid);
  if (!targetUid || typeof targetUid !== 'string') {
    throw new WorkspaceAdminError('Guru yang dikeluarkan tidak valid.', 400);
  }
  if (targetUid === uid) {
    throw new WorkspaceAdminError('Pemilik tidak bisa mengeluarkan dirinya sendiri.', 400);
  }
  const targetRef = adminDb.collection(TEACHER_PROFILES_COLLECTION).doc(targetUid);
  const targetSnap = await targetRef.get();
  const target = targetSnap.data() as { workspaceId?: string; role?: string } | undefined;
  if (!targetSnap.exists || target?.workspaceId !== workspaceId) {
    throw new WorkspaceAdminError('Guru tidak ditemukan di workspace ini.', 404);
  }
  if (target?.role === 'OWNER') {
    throw new WorkspaceAdminError('Pemilik workspace tidak bisa dikeluarkan.', 400);
  }
  await targetRef.update({
    workspaceId: FieldValue.delete(),
    role: FieldValue.delete(),
    homeroomClassName: FieldValue.delete(),
  });
}
