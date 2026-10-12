import { FieldValue, type Firestore } from 'firebase-admin/firestore';

// Pagar penyalahgunaan: tiap ekspor membaca seluruh data workspace dan memakai kuota baca Firestore yang SAMA dengan aplikasi.
// Satu ekspor per workspace per jendela waktu. Disimpan di backup_exports/{workspaceId} (hanya Admin SDK; tidak ada rule klien).
export const DEFAULT_COOLDOWN_SECONDS = 300;

export type Slot = { ok: true; release: () => Promise<void> } | { ok: false; retryAfterSeconds: number };

export async function claimExportSlot(db: Firestore, ws: string, role: string, cooldownSeconds: number, nowMs = Date.now()): Promise<Slot> {
  const ref = db.collection('backup_exports').doc(ws);
  const prev = await db.runTransaction(async (t) => {
    const last = Number((await t.get(ref)).data()?.lastStartedAtMs ?? 0);
    if (cooldownSeconds > 0 && nowMs - last < cooldownSeconds * 1000) return { denied: Math.ceil((cooldownSeconds * 1000 - (nowMs - last)) / 1000) };
    t.set(ref, { workspaceId: ws, lastStartedAtMs: nowMs, lastRole: role, updatedAt: FieldValue.serverTimestamp(), count: FieldValue.increment(1) }, { merge: true });
    return { last };
  });
  if ('denied' in prev) return { ok: false, retryAfterSeconds: prev.denied as number };
  return { ok: true, release: async () => { await ref.set({ lastStartedAtMs: prev.last as number }, { merge: true }); } };
}
