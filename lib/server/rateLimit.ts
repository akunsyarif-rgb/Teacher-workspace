import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

// Pembatas percobaan gagal (anti brute-force) yang bertahan lintas instance
// serverless — state di Firestore koleksi `rate_limits` (hanya Admin SDK;
// tidak ada rule klien, jadi tertutup bagi client). Id dokumen = hash kunci,
// sehingga IP/uid tidak tersimpan mentah. Kolom `expiresAt` bisa dipakai
// sebagai kebijakan TTL Firestore untuk pembersihan otomatis (opsional).
//
// Yang dihitung hanya percobaan GAGAL: satu kelas yang login bersamaan lewat
// IP sekolah yang sama (NAT) tidak saling memblokir selama kodenya benar.
const COLLECTION = 'rate_limits';

export type RateRule = { key: string; limit: number; windowSeconds: number };
export type RateCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

function docIdFor(key: string) {
  return createHash('sha256').update(key).digest('hex').slice(0, 40);
}

export function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

type Stored = { count?: number; windowStartMs?: number };

function activeCount(data: Stored | undefined, rule: RateRule, nowMs: number) {
  const start = data?.windowStartMs ?? 0;
  if (!data || nowMs - start >= rule.windowSeconds * 1000) return { count: 0, start: nowMs };
  return { count: data.count ?? 0, start };
}

// Tolak bila SALAH SATU aturan sudah mencapai batas pada jendela waktunya.
export async function checkRateLimits(db: Firestore, rules: RateRule[], nowMs = Date.now()): Promise<RateCheck> {
  let retry = 0;
  for (const rule of rules) {
    const snap = await db.collection(COLLECTION).doc(docIdFor(rule.key)).get();
    const { count, start } = activeCount(snap.exists ? (snap.data() as Stored) : undefined, rule, nowMs);
    if (count >= rule.limit) {
      retry = Math.max(retry, Math.ceil((start + rule.windowSeconds * 1000 - nowMs) / 1000));
    }
  }
  return retry > 0 ? { ok: false, retryAfterSeconds: retry } : { ok: true };
}

// Catat satu percobaan gagal pada semua aturan, atomik per permintaan.
export async function recordFailures(db: Firestore, rules: RateRule[], nowMs = Date.now()): Promise<void> {
  await db.runTransaction(async (tx) => {
    const refs = rules.map((r) => db.collection(COLLECTION).doc(docIdFor(r.key)));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    rules.forEach((rule, i) => {
      const { count, start } = activeCount(snaps[i].exists ? (snaps[i].data() as Stored) : undefined, rule, nowMs);
      tx.set(refs[i], {
        count: count + 1,
        windowStartMs: start,
        expiresAt: Timestamp.fromMillis(start + rule.windowSeconds * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  });
}
