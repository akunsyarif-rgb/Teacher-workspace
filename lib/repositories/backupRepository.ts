// Backup & Ekspor Data: SEMUA lewat route server terautentikasi (/api/backup/*). Klien tidak membaca database untuk backup
// dan tidak mengirim workspace/peran: server menurunkannya dari token. Arsip tidak pernah disimpan di server atau URL publik.
export class BackupApiError extends Error {
  constructor(public code: string, public status: number, message: string, public retryAfterSeconds?: number) {
    super(message);
    this.name = 'BackupApiError';
  }
}

export type CallDeps = { getToken?: () => Promise<string | null>; fetchImpl?: typeof fetch };
let deps: CallDeps = {};
/** Hanya untuk tes. */
export const __setBackupDeps = (d: CallDeps) => { deps = d; };

const DOWNLOAD_TIMEOUT_MS = 180_000;

async function post(route: string, body: unknown): Promise<Response> {
  const getToken = deps.getToken ?? (async () => {
    const { auth } = await import('@/src/config/firebase');
    await auth.authStateReady();
    return (await auth.currentUser?.getIdToken()) ?? null;
  });
  const token = await getToken();
  if (!token) throw new BackupApiError('not_logged_in', 401, 'Sesi berakhir. Masuk kembali lalu coba lagi.');
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(`/api/backup/${route}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new BackupApiError('network', 0, 'Tidak dapat terhubung ke server. Periksa internet Anda lalu coba lagi.');
  }
  if (!res.ok) {
    let j: { error?: string; code?: string } = {};
    try { j = await res.json(); } catch { /* bukan JSON */ }
    const retry = Number(res.headers.get('retry-after')) || undefined;
    throw new BackupApiError(j.code ?? `http_${res.status}`, res.status, j.error ?? 'Backup gagal dibuat. Coba lagi.', retry);
  }
  return res;
}

// Isi dibaca UTUH sebelum dianggap berhasil: bila koneksi putus di tengah unduhan, arrayBuffer() gagal → tidak ada arsip setengah jadi.
async function readAll(res: Response): Promise<Uint8Array> {
  try { return new Uint8Array(await res.arrayBuffer()); } catch {
    throw new BackupApiError('interrupted', 0, 'Unduhan terputus sebelum selesai, sehingga arsip tidak disimpan. Coba lagi dengan koneksi yang lebih stabil.');
  }
}

export async function downloadExport(): Promise<{ bytes: Uint8Array; filename: string }> {
  const res = await post('export', {});
  const name = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'teacher-workspace-backup.zip';
  return { bytes: await readAll(res), filename: name };
}

export type AttachmentPlanFile = { path: string; name: string | null; assignmentId: string | null; studentId: string | null; className: string | null };
export async function fetchAttachmentPlan(): Promise<AttachmentPlanFile[]> {
  const res = await post('attachments', { action: 'plan' });
  return ((await res.json()) as { files: AttachmentPlanFile[] }).files;
}
export async function downloadAttachmentPart(paths: string[]): Promise<{ bytes: Uint8Array; included: number; skipped: number }> {
  const res = await post('attachments', { action: 'part', paths });
  const included = Number(res.headers.get('x-backup-part-included'));
  if (!Number.isInteger(included) || included < 1) throw new BackupApiError('bad_part', 0, 'Respons lampiran tidak valid. Coba lagi.');
  const skipped = Number(res.headers.get('x-backup-part-skipped')) || 0;
  return { bytes: await readAll(res), included, skipped };
}
