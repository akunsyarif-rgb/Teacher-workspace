import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { AuthFailure, authenticate } from '@/lib/server/requireAuth';
import { limitRequests } from '@/lib/server/rateLimit';
import { ulanganRpc } from '@/lib/server/ulanganSupabase';
import { BackupAuthError, resolveBackupActor } from '@/lib/server/backup/actor';
import { claimExportSlot, DEFAULT_COOLDOWN_SECONDS } from '@/lib/server/backup/cooldown';
import { countExportDocs, exportZip } from '@/lib/server/backup/exportWorkspace';
import { exportRateLimits, resolveMaxDocs } from '@/lib/server/backup/limits';
import { firestoreIdentity, makeUlanganCollector } from '@/lib/server/backup/ulanganExport';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const fail = (status: number, code: string, error: string, headers: Record<string, string> = {}) => NextResponse.json({ error, code }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const pad = (n: number) => String(n).padStart(2, '0');

// Ekspor data workspace guru sebagai ZIP. Token Firebase diverifikasi (termasuk pencabutan sesi); identitas, workspace, dan peran
// dibaca dari Firestore — TIDAK dari body. Respons streaming, tanpa berkas sementara, tanpa cache, tanpa URL publik.
export async function POST(request: NextRequest) {
  let uid: string;
  let db: ReturnType<typeof getAdminDb>;
  try {
    ({ uid } = await authenticate(request));
    db = getAdminDb();
  } catch (error) {
    if (error instanceof AuthFailure) {
      return error.code === 'server_config'
        ? fail(503, 'server_config', 'Server belum dikonfigurasi untuk backup. Hubungi admin.')
        : fail(error.status, error.code, error.code === 'no_token' ? 'Token otentikasi diperlukan.' : 'Sesi tidak valid. Masuk kembali lalu coba lagi.');
    }
    logger.error('backup_export.config_invalid');
    return fail(503, 'server_config', 'Server belum dikonfigurasi untuk backup. Hubungi admin.');
  }

  // Pagar tambahan di depan cooldown per-workspace: ekspor membaca seluruh data workspace dan memakai kuota baca yang sama
  // dengan aplikasi. Setiap permintaan (termasuk yang ditolak cooldown) dihitung, supaya spam tidak lolos ke Firestore.
  const limited = await limitRequests(db, request, uid, 'backup-export', exportRateLimits());
  if (limited) return fail(429, 'rate_limited', limited.message, { 'Retry-After': String(limited.retryAfterSeconds) });

  let release: (() => Promise<void>) | null = null;
  try {
    const actor = await resolveBackupActor(db, uid);
    const cooldown = Number(process.env.BACKUP_COOLDOWN_SECONDS ?? DEFAULT_COOLDOWN_SECONDS);
    const slot = await claimExportSlot(db, actor.ws, actor.role, Number.isFinite(cooldown) ? cooldown : DEFAULT_COOLDOWN_SECONDS);
    if (!slot.ok) return fail(429, 'cooldown', `Backup baru saja dibuat. Coba lagi dalam ${Math.ceil(slot.retryAfterSeconds / 60)} menit.`, { 'Retry-After': String(slot.retryAfterSeconds) });
    release = slot.release;

    const { value: maxDocs, source } = resolveMaxDocs();
    if (source === 'clamped' || source === 'invalid') logger.warn('backup_export.max_docs_ignored', { source });
    const total = await countExportDocs(db, actor);
    if (total > maxDocs) { await release(); return fail(413, 'too_large', `Data terlalu besar untuk satu unduhan (±${total} dokumen, batas ${maxDocs}). Hubungi admin.`); }

    const collector = makeUlanganCollector({ rpc: (n, a) => ulanganRpc(n, a), src: firestoreIdentity(db) });
    const now = new Date();
    const wita = new Date(now.getTime() + 8 * 3600_000);
    const filename = `teacher-workspace-backup-${wita.getUTCFullYear()}${pad(wita.getUTCMonth() + 1)}${pad(wita.getUTCDate())}-${pad(wita.getUTCHours())}${pad(wita.getUTCMinutes())}.zip`;
    // Bila aliran gagal di tengah jalan: lepas slot (guru boleh mencoba lagi) dan putuskan koneksi — arsip yang terpotong tidak sah.
    const rel = release;
    async function* guarded() {
      try { yield* exportZip(actor, { db, now, ulangan: collector }); }
      catch (e) { await rel().catch(() => {}); logger.error('backup_export.stream_failed', { errorName: e instanceof Error ? e.name : typeof e }); throw e; }
    }
    const body = Readable.toWeb(Readable.from(guarded())) as ReadableStream;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'X-Backup-Docs-Estimate': String(total),
      },
    });
  } catch (e) {
    if (release) await release().catch(() => {});
    if (e instanceof BackupAuthError) return fail(403, 'not_a_teacher', 'Akun ini bukan akun guru aktif di sebuah workspace.');
    logger.error('backup_export.failed', { errorName: e instanceof Error ? e.name : typeof e }); // tanpa pesan: bisa memuat data/kredensial
    return fail(500, 'export_failed', 'Backup gagal dibuat. Coba lagi beberapa saat lagi.');
  }
}
