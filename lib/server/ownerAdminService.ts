import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin';

const WORKSPACES_COLLECTION = 'workspaces';
const TEACHER_PROFILES_COLLECTION = 'teacher_profiles';

export const OWNER_PLANS = ['individual_lifetime', 'individual_onetime', 'individual_monthly', 'school_annual'] as const;
export type OwnerPlan = (typeof OWNER_PLANS)[number];

export class OwnerPanelError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Panel pemilik APLIKASI (bukan pemilik workspace): hanya uid yang tercantum
// di env APP_OWNER_UIDS (dipisah koma) yang boleh masuk. Env kosong/tidak ada
// = semua ditolak (fail closed). Uid dipakai, bukan email, karena uid tidak
// bisa dipalsukan lewat pendaftaran akun.
export function parseOwnerUids(raw: string | undefined): Set<string> {
  return new Set((raw || '').split(',').map((s) => s.trim()).filter(Boolean));
}

export function assertAppOwner(uid: string, raw: string | undefined = process.env.APP_OWNER_UIDS) {
  if (!uid || !parseOwnerUids(raw).has(uid)) {
    throw new OwnerPanelError('Halaman ini khusus pemilik aplikasi.', 403);
  }
}

export type OwnerWorkspaceRow = {
  id: string;
  name: string;
  plan: string;
  seatLimit: number | null;
  classLimit: number | null;
  planExpiresAt: number | null;
  ownerUid: string;
  memberCount: number;
};

export async function listWorkspacesForOwnerServer(uid: string): Promise<OwnerWorkspaceRow[]> {
  assertAppOwner(uid);
  const db = getAdminDb();
  const snap = await db.collection(WORKSPACES_COLLECTION).limit(200).get();
  return Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data() as Record<string, unknown>;
      const count = await db.collection(TEACHER_PROFILES_COLLECTION).where('workspaceId', '==', d.id).count().get();
      return {
        id: d.id,
        name: typeof data.name === 'string' ? data.name : '',
        plan: typeof data.plan === 'string' ? data.plan : '',
        seatLimit: typeof data.seatLimit === 'number' ? data.seatLimit : null,
        classLimit: typeof data.classLimit === 'number' ? data.classLimit : null,
        planExpiresAt: typeof data.planExpiresAt === 'number' ? data.planExpiresAt : null,
        ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : '',
        memberCount: count.data().count,
      };
    })
  );
}

export type OwnerWorkspacePatch = {
  plan?: unknown;
  seatLimit?: unknown;
  classLimit?: unknown;
  planExpiresAt?: unknown;
};

function limitOrNull(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100000) {
    throw new OwnerPanelError(`${label} harus bilangan bulat 1-100000, atau kosong untuk tak terbatas.`, 400);
  }
  return value;
}

// Hanya field yang DIKIRIM yang diubah; nilai divalidasi ketat di sini
// (daftar plan putih, angka bulat), tidak pernah dipercaya dari klien.
export async function updateWorkspaceForOwnerServer(uid: string, workspaceId: unknown, patch: OwnerWorkspacePatch) {
  assertAppOwner(uid);
  if (typeof workspaceId !== 'string' || !workspaceId) {
    throw new OwnerPanelError('Workspace tidak valid.', 400);
  }
  const update: Record<string, unknown> = {};
  if (patch.plan !== undefined) {
    if (typeof patch.plan !== 'string' || !(OWNER_PLANS as readonly string[]).includes(patch.plan)) {
      throw new OwnerPanelError('Plan tidak dikenal.', 400);
    }
    update.plan = patch.plan;
  }
  if (patch.seatLimit !== undefined) update.seatLimit = limitOrNull(patch.seatLimit, 'Kuota guru');
  if (patch.classLimit !== undefined) update.classLimit = limitOrNull(patch.classLimit, 'Batas kelas');
  if (patch.planExpiresAt !== undefined) {
    if (patch.planExpiresAt !== null && (typeof patch.planExpiresAt !== 'number' || !Number.isFinite(patch.planExpiresAt) || patch.planExpiresAt < 0)) {
      throw new OwnerPanelError('Tanggal berakhir tidak valid.', 400);
    }
    update.planExpiresAt = patch.planExpiresAt;
  }
  if (Object.keys(update).length === 0) {
    throw new OwnerPanelError('Tidak ada perubahan.', 400);
  }

  const ref = getAdminDb().collection(WORKSPACES_COLLECTION).doc(workspaceId);
  const snap = await ref.get();
  if (!snap.exists) throw new OwnerPanelError('Workspace tidak ditemukan.', 404);
  await ref.update({ ...update, updatedAt: FieldValue.serverTimestamp() });
  console.info('[owner-panel] workspace diubah', workspaceId, Object.keys(update).join(','));
}
