import type { Firestore } from 'firebase-admin/firestore';
import type { Actor, Role } from './inventory';

export class BackupAuthError extends Error {
  constructor(public code: 'not_a_teacher', public status = 403) {
    super(code);
    this.name = 'BackupAuthError';
  }
}

const ROLES = new Set<Role>(['OWNER', 'ADMIN', 'TEACHER']);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Identitas pengekspor dibaca dari Firestore (sumber kebenaran TW), BUKAN dari body/klaim klien. uid hanya dari ID token
 * terverifikasi. Aturan sama dengan Ulangan Harian: profil aktif, peran sah, workspace ada, OWNER harus cocok ownerUid.
 */
export async function resolveBackupActor(db: Firestore, uid: string): Promise<Actor> {
  const p = (await db.collection('teacher_profiles').doc(uid).get()).data();
  const ws = str(p?.workspaceId);
  const role = str(p?.role) as Role;
  if (!p || !ws || !ROLES.has(role) || p.isActive === false) throw new BackupAuthError('not_a_teacher');
  const w = (await db.collection('workspaces').doc(ws).get()).data();
  if (!w || (role === 'OWNER' && str(w.ownerUid) !== uid)) throw new BackupAuthError('not_a_teacher');
  return {
    uid, ws, role, admin: role === 'OWNER' || role === 'ADMIN',
    homeroomClassName: str(p.homeroomClassName) || null,
    workspace: { id: ws, name: str(w.name) || null, plan: str(w.plan) || null },
  };
}
