import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { zipStream } from '@/lib/backup/zip.mjs';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { AuthFailure, authenticate } from '@/lib/server/requireAuth';
import { limitRequests } from '@/lib/server/rateLimit';
import { ulanganSupabaseConfig, UlanganDbError } from '@/lib/server/ulanganSupabase';
import { BackupAuthError, resolveBackupActor } from '@/lib/server/backup/actor';
import { claimExportSlot } from '@/lib/server/backup/cooldown';
import { AttachmentLimitError, partEntries, PathError, planAttachments, probePart, validatePaths } from '@/lib/server/backup/attachments';
import { attachmentsRateLimits, planCooldownSeconds } from '@/lib/server/backup/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const fail = (status: number, code: string, error: string, headers: Record<string, string> = {}) => NextResponse.json({ error, code }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

// Dua aksi: "plan" (daftar lampiran Supabase milik workspace) dan "part" (ZIP berisi sebagian lampiran). Otorisasi sama dengan
// /api/backup/export; path yang diminta harus berada di bawah submissions/<workspace sendiri>/.
export async function POST(request: NextRequest) {
  let uid: string;
  let db: ReturnType<typeof getAdminDb>;
  try {
    ({ uid } = await authenticate(request));
    db = getAdminDb();
  } catch (error) {
    if (error instanceof AuthFailure && error.code !== 'server_config') {
      return fail(error.status, error.code, error.code === 'no_token' ? 'Token otentikasi diperlukan.' : 'Sesi tidak valid. Masuk kembali lalu coba lagi.');
    }
    return fail(503, 'server_config', 'Server belum dikonfigurasi untuk backup. Hubungi admin.');
  }

  // Satu backup lampiran = 1 permintaan "plan" + banyak "part" (ZIP per bagian), jadi batasnya jauh lebih longgar dari ekspor Firestore.
  const limited = await limitRequests(db, request, uid, 'backup-attachments', attachmentsRateLimits());
  if (limited) return fail(429, 'rate_limited', limited.message, { 'Retry-After': String(limited.retryAfterSeconds) });

  let body: { action?: unknown; paths?: unknown };
  try { body = await request.json(); } catch { return fail(400, 'invalid_body', 'Permintaan tidak valid.'); }

  try {
    const actor = await resolveBackupActor(db, uid);
    if (body.action === 'plan') {
      const slot = await claimExportSlot(db, `${actor.ws}__lampiran`, actor.role, planCooldownSeconds());
      if (!slot.ok) return fail(429, 'cooldown', `Daftar lampiran baru saja dibuat. Coba lagi dalam ${Math.ceil(slot.retryAfterSeconds / 60)} menit.`, { 'Retry-After': String(slot.retryAfterSeconds) });
      try {
        return NextResponse.json({ files: await planAttachments(db, actor) }, { headers: { 'Cache-Control': 'no-store' } });
      } catch (e) {
        if (e instanceof AttachmentLimitError) return fail(413, 'too_many_submissions', `Terlalu banyak pengumpulan tugas untuk diunduh lampirannya sekaligus (${e.total} dokumen, batas ${e.max}). Hubungi admin; mengulang tidak akan membantu.`);
        await slot.release().catch(() => {}); // gagal tak terduga: jangan menghukum guru dengan cooldown
        throw e;
      }
    }
    if (body.action !== 'part') return fail(400, 'unknown_action', 'Aksi tidak dikenal.');

    const paths = validatePaths(actor.ws, body.paths);
    let storage: { url: string; key: string };
    try { storage = ulanganSupabaseConfig(); } catch (e) {
      if (e instanceof UlanganDbError && e.kind === 'config') return fail(503, 'storage_not_configured', 'Penyimpanan lampiran belum dikonfigurasi di server ini.');
      throw e;
    }
    const probe = await probePart(storage, paths);
    const chosen = paths.slice(0, probe.included);
    const now = new Date();
    const stream = Readable.toWeb(Readable.from(zipStream(partEntries(storage, chosen, now, probe), { now }))) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="lampiran-bagian.zip"',
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'X-Backup-Part-Included': String(chosen.length),
        'X-Backup-Part-Skipped': String(probe.oversized.length),
      },
    });
  } catch (e) {
    if (e instanceof BackupAuthError) return fail(403, 'not_a_teacher', 'Akun ini bukan akun guru aktif di sebuah workspace.');
    if (e instanceof PathError) return fail(400, e.message, 'Permintaan lampiran tidak valid.');
    console.error('backup lampiran gagal:', e instanceof Error ? e.name : typeof e);
    return fail(500, 'attachments_failed', 'Lampiran gagal diproses. Coba lagi.');
  }
}
