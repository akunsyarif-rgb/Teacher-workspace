import { FieldValue } from 'firebase-admin/firestore';
import { ApiError } from './apiErrors';
import { getAdminAuth, getAdminDb } from './firebaseAdmin';
import { INVITE_CODE_VALID_MS, isSeatLimitReached } from '../config/plans';
import { logger } from '../utils/logger';

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
export async function joinWorkspaceByCodeServer(uid: string, inviteCode: string): Promise<WorkspaceRecord> {
  const adminDb = getAdminDb();

  const trimmedCode = typeof inviteCode === 'string' ? inviteCode.trim().toUpperCase() : '';
  if (!trimmedCode) {
    throw new ApiError('Mohon masukkan kode undangan.', 400);
  }

  const profileRef = adminDb.collection(TEACHER_PROFILES_COLLECTION).doc(uid);

  // Cek kuota kursi + penulisan profil dalam SATU transaksi. Sebelumnya count()
  // lalu set() terpisah: N guru yang join bersamaan sama-sama membaca "masih
  // ada kursi" dan semuanya lolos melewati seatLimit.
  //
  // Dua lapis pengaman supaya join paralel pasti bertabrakan (lalu transaksi
  // yang kalah di-retry SDK dan membaca hitungan baru): (1) query anggota
  // dibaca di dalam transaksi, (2) dokumen workspace ikut DITULIS di setiap
  // join (updatedAt) — satu dokumen yang sama untuk semua join ke workspace
  // itu, sehingga konflik tidak bergantung pada perilaku penguncian rentang query.
  return adminDb.runTransaction(async (tx) => {
    const existingProfileSnap = await tx.get(profileRef);
    if (existingProfileSnap.exists && existingProfileSnap.data()?.workspaceId) {
      throw new ApiError('Akun ini sudah terhubung ke sebuah Workspace. Satu akun hanya boleh memiliki satu Workspace.', 409);
    }

    const bridgeSnap = await tx.get(adminDb.collection(WORKSPACE_INVITES_COLLECTION).doc(trimmedCode));
    const workspaceId = bridgeSnap.exists ? (bridgeSnap.data() as { workspaceId?: string }).workspaceId : null;
    if (!workspaceId) {
      throw new ApiError('Kode undangan tidak ditemukan.', 404);
    }

    const workspaceRef = adminDb.collection(WORKSPACES_COLLECTION).doc(workspaceId);
    const workspaceSnap = await tx.get(workspaceRef);
    if (!workspaceSnap.exists) {
      throw new ApiError('Kode undangan tidak ditemukan.', 404);
    }
    const workspace = { id: workspaceSnap.id, ...workspaceSnap.data() } as WorkspaceRecord;

    // Kode yang sudah diganti (regenerateInviteCode) tetap ditolak: jembatan lama
    // boleh tersisa, tapi tidak cocok lagi dengan kode aktif workspace-nya.
    if (workspace.inviteCode !== trimmedCode) {
      throw new ApiError('Kode undangan tidak ditemukan.', 404);
    }
    // Kedaluwarsa dinilai dengan JAM SERVER FIRESTORE (readTime transaksi), dari saat kode dibuat
    // (inviteCodeIssuedAt, serverTimestamp) — bukan jam perangkat pembuat kode maupun jam instance.
    // Kode lama tanpa inviteCodeIssuedAt memakai inviteCodeExpiresAt seperti sebelumnya.
    const serverNowMs = workspaceSnap.readTime?.toMillis?.() ?? Date.now();
    const issuedAtMs = (workspace as { inviteCodeIssuedAt?: { toMillis?: () => number } }).inviteCodeIssuedAt?.toMillis?.();
    const expiresAtMs = issuedAtMs !== undefined ? issuedAtMs + INVITE_CODE_VALID_MS : workspace.inviteCodeExpiresAt;
    if (expiresAtMs && expiresAtMs < serverNowMs) {
      throw new ApiError('Kode undangan sudah kedaluwarsa. Minta admin sekolah membuat kode baru.', 410);
    }

    const membersSnap = await tx.get(
      adminDb.collection(TEACHER_PROFILES_COLLECTION).where('workspaceId', '==', workspaceId).select()
    );
    if (isSeatLimitReached(workspace, membersSnap.size)) {
      throw new ApiError(
        `Kuota guru workspace ini sudah penuh (maks ${workspace.seatLimit} guru). Admin sekolah perlu membeli kursi tambahan lewat halaman upgrade.`,
        409
      );
    }

    tx.set(profileRef, { workspaceId, role: 'TEACHER', isActive: true }, { merge: true });
    tx.update(workspaceRef, { updatedAt: FieldValue.serverTimestamp() });
    return workspace;
  });
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

export class WorkspaceAdminError extends ApiError {}

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

export async function listWorkspaceMembersServer(uid: string) {
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
      logger.error('workspace_members.load_emails_failed', { err: error });
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
export async function removeWorkspaceMemberServer(uid: string, targetUid: string) {
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
