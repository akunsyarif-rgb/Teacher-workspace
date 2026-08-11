import { getAdminDb } from './firebaseAdmin';
import { isSeatLimitReached } from '../config/plans';

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
      `Kuota guru workspace ini sudah penuh (maks ${workspace.seatLimit} guru). Admin sekolah perlu membeli kursi tambahan lewat halaman upgrade.`
    );
  }

  await adminDb
    .collection(TEACHER_PROFILES_COLLECTION)
    .doc(uid)
    .set({ workspaceId, role: 'TEACHER', isActive: true }, { merge: true });

  return workspace;
}
