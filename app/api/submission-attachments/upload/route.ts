import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { requireAuth } from '@/lib/server/requireAuth';
import { ApiError, parseBody } from '@/lib/server/apiErrors';
import { UploadSignBodySchema } from '@/lib/schemas/api';
import { limitRequests } from '@/lib/server/rateLimit';
import { canStudentSubmit } from '@/lib/utils/submissionRules';
import { MAX_ATTACHMENTS_PER_SUBMISSION, validateUploadRequest } from '@/lib/utils/uploadRules';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';

const BUCKET = 'submission-attachments';

// Pembatas penandatanganan: tiap permintaan dihitung (bukan hanya yang gagal), supaya akun anonim
// tidak bisa meminta tiket upload tanpa batas dan menghabiskan kuota Storage. Per-IP longgar
// karena satu kelas bisa berbagi IP sekolah.
const SIGN_WINDOW_SECONDS = 10 * 60;
const SIGN_MAX_PER_UID = 40;
const SIGN_MAX_PER_IP = 600;

class SupabaseConfigError extends Error {
  constructor() {
    super('Konfigurasi penyimpanan Supabase belum lengkap.');
  }
}

function supabaseConfig() {
  const rawUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  // Hanya origin yang dipakai: nilai env yang terlanjur memuat path
  // (/rest/v1, /storage/v1, slash akhir) membuat Supabase membalas
  // 404 "Invalid path specified in request URL".
  let url: string | undefined;
  try {
    url = rawUrl ? new URL(rawUrl).origin : undefined;
  } catch {
    url = undefined;
  }
  if (!url || !key) throw new SupabaseConfigError();
  return { url, key };
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(-80) || 'lampiran';
}

function encodedPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, {
    configErrorMessage: 'Server belum dikonfigurasi untuk unggah lampiran. Hubungi gurumu.',
  });
  if (auth instanceof NextResponse) return auth;
  const { uid } = auth;

  try {
    const { workspaceId, assignmentId, fileName, contentType, fileSize } = parseBody(
      UploadSignBodySchema,
      await request.json().catch(() => ({})),
      'Data tugas atau file tidak valid.'
    );
    const upload = validateUploadRequest({ fileName, contentType, fileSize });
    if (!upload.ok) {
      return NextResponse.json({ error: upload.error }, { status: upload.status });
    }

    const db = getAdminDb();
    const studentSnap = await db.collection('student_profiles').doc(uid).get();
    const assignmentSnap = await db.collection('assignments').doc(assignmentId).get();
    if (!studentSnap.exists) {
      return NextResponse.json({ error: 'Akun ini bukan akun siswa.' }, { status: 403 });
    }

    const student = studentSnap.data()!;
    const assignment = assignmentSnap.data();
    if (
      !assignmentSnap.exists ||
      student.workspaceId !== workspaceId ||
      assignment?.workspaceId !== workspaceId ||
      student.className !== assignment?.className
    ) {
      return NextResponse.json({ error: 'Tugas tidak ditemukan untuk kelas atau akun ini.' }, { status: 403 });
    }

    // Tegakkan tenggat dan status penilaian sebelum membuat token upload,
    // agar endpoint tidak bisa dipakai untuk tugas yang sudah ditutup.
    const existingSubmissionSnap = await db.collection('submissions').doc(`${assignmentId}_${student.studentId}`).get();
    const gate = canStudentSubmit(existingSubmissionSnap.exists ? existingSubmissionSnap.data() : null, assignment?.dueDate);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason }, { status: 409 });
    }
    const existingAttachments = existingSubmissionSnap.data()?.attachments;
    if (Array.isArray(existingAttachments) && existingAttachments.length >= MAX_ATTACHMENTS_PER_SUBMISSION) {
      return NextResponse.json({ error: `Maksimal ${MAX_ATTACHMENTS_PER_SUBMISSION} lampiran per pengumpulan.` }, { status: 409 });
    }

    // Terakhir sebelum meminta tiket ke Supabase: hanya permintaan yang lolos semua validasi yang dihitung.
    const limited = await limitRequests(db, request, uid, 'submission-upload-sign', {
      perUid: SIGN_MAX_PER_UID,
      perIp: SIGN_MAX_PER_IP,
      windowSeconds: SIGN_WINDOW_SECONDS,
    });
    if (limited) {
      return NextResponse.json({ error: limited.message }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } });
    }

    const { url, key } = supabaseConfig();
    const safeFileName = safeName(fileName);
    const path = `submissions/${workspaceId}/${assignmentId}/${uid}/${randomUUID()}_${safeFileName}`;
    // File besar tidak melewati Vercel Function (yang memiliki batas payload
    // lebih kecil dari batas bucket). Server hanya memberi token upload
    // sekali pakai untuk path unik setelah memeriksa izin Firebase.
    const response = await fetch(`${url}/storage/v1/object/upload/sign/${BUCKET}/${encodedPath(path)}`, {
      method: 'POST',
      headers: {
        apikey: key,
        // Secret key format baru (sb_secret_...) bukan JWT: kirim lewat
        // apikey saja. Authorization Bearer hanya untuk service_role JWT lama.
        ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
        'x-upsert': 'false',
      },
      body: JSON.stringify({}),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // Detail dari Supabase hanya ke log server; client menerima kode status saja.
      const detail = await response.text().catch(() => '');
      logger.error('submission_upload.supabase_failed', { upstreamStatus: response.status, detail });
      return NextResponse.json(
        {
          error: `Upload belum bisa disiapkan (penyimpanan menolak: ${response.status}). Coba lagi nanti.`,
          code: 'supabase_sign_failed',
          upstreamStatus: response.status,
        },
        { status: 502 }
      );
    }

    const result = await response.json();
    const token = result.token || new URL(result.url, `${url}/storage/v1`).searchParams.get('token');
    if (typeof token !== 'string' || !token) {
      return NextResponse.json({ error: 'Token upload sementara tidak berhasil dibuat.' }, { status: 502 });
    }
    const signedUrl = result.url?.startsWith('http')
      ? result.url
      : `${url}/storage/v1${String(result.url || '').startsWith('/') ? result.url : `/${result.url || ''}`}`;
    if (!signedUrl || signedUrl.endsWith('/')) {
      return NextResponse.json({ error: 'URL upload sementara tidak valid.' }, { status: 502 });
    }

    return NextResponse.json({ signedUrl, token, path, fileName });
  } catch (error) {
    // Validasi body (parseBody) dan penolakan disengaja: pesan aman + status-nya.
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SupabaseConfigError) {
      logger.error('submission_upload.config_missing');
      return NextResponse.json({ error: 'Penyimpanan lampiran belum dikonfigurasi. Hubungi gurumu.', code: 'server_config' }, { status: 503 });
    }
    logger.error('submission_upload.failed', { err: error });
    return NextResponse.json({ error: 'Upload belum bisa disiapkan. Periksa koneksi dan coba lagi.' }, { status: 500 });
  }
}
