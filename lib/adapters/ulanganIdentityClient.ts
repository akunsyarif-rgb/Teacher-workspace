// Klien sinkronisasi identitas Ulangan Harian: meminta SERVER memproyeksikan identitas dari Firestore ke Supabase.
// Klien tidak mengirim identitas apa pun selain ID token (server membaca kebenaran dari Firestore).
export class IdentitySyncError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'IdentitySyncError';
  }
}

export async function syncUlanganIdentity(
  roster: boolean,
  deps: { getToken?: () => Promise<string | null>; fetchImpl?: typeof fetch } = {}
): Promise<{ kind: 'teacher' | 'student' | null }> {
  const getToken = deps.getToken ?? (async () => (await import('@/src/config/firebase')).auth.currentUser?.getIdToken() ?? null);
  const token = await getToken();
  if (!token) throw new IdentitySyncError('identity_sync: belum login', 401);
  const res = await (deps.fetchImpl ?? fetch)('/api/ulangan/sync-identity', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roster }),
  });
  if (!res.ok) throw new IdentitySyncError(`identity_sync: HTTP ${res.status}`, res.status);
  const j = (await res.json()) as { kind?: 'teacher' | 'student' | null };
  return { kind: j.kind ?? null };
}
