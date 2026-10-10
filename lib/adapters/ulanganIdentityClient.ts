// Klien sinkronisasi identitas Ulangan Harian: meminta SERVER memproyeksikan identitas dari Firestore ke Supabase.
// Klien tidak mengirim identitas apa pun selain ID token (server membaca kebenaran dari Firestore).
export class IdentitySyncError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'IdentitySyncError';
  }
}

// Saat banyak siswa mulai bersamaan server bisa menjawab 429/503 + Retry-After: coba lagi berjeda (jitter), maksimal 3 kali.
const MAX_ATTEMPTS = 3;

export async function syncUlanganIdentity(
  roster: boolean,
  deps: { getToken?: () => Promise<string | null>; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number } = {}
): Promise<{ kind: 'teacher' | 'student' | null }> {
  const getToken = deps.getToken ?? (async () => (await import('@/src/config/firebase')).auth.currentUser?.getIdToken() ?? null);
  const token = await getToken();
  if (!token) throw new IdentitySyncError('identity_sync: belum login', 401);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  let res!: Response;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await (deps.fetchImpl ?? fetch)('/api/ulangan/sync-identity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roster }),
    });
    if ((res.status !== 429 && res.status !== 503) || attempt === MAX_ATTEMPTS) break;
    const retryAfter = Math.min(10, Math.max(1, Number(res.headers.get('Retry-After')) || 2));
    await sleep(Math.round((retryAfter + random() * 2) * 1000));
  }
  if (!res.ok) throw new IdentitySyncError(`identity_sync: HTTP ${res.status}`, res.status);
  const j = (await res.json()) as { kind?: 'teacher' | 'student' | null };
  return { kind: j.kind ?? null };
}
