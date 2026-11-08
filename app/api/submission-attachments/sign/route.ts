import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { requireAuth } from '@/lib/server/requireAuth';
import { ApiError, parseBody } from '@/lib/server/apiErrors';
import { SignDownloadBodySchema } from '@/lib/schemas/api';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';

const BUCKET = 'submission-attachments';
const SIGNED_URL_TTL_SECONDS = 300;

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
    const { filePath: path } = parseBody(SignDownloadBodySchema, await request.json().catch(() => ({})), 'Path lampiran tidak valid.');

    const parts = path.split('/');
    // submissions/{workspaceId}/{assignmentId}/{studentUid}/{filename}
    if (
      parts.length !== 5 ||
      parts[0] !== 'submissions' ||
      !parts[1] ||
      !parts[2] ||
      !parts[3] ||
      !parts[4] ||
      parts.some((part: string) => part === '.' || part === '..')
    ) {
      return NextResponse.json({ error: 'Path lampiran tidak valid.' }, { status: 400 });
    }

    const [, workspaceId, assignmentId, ownerUid] = parts;
    const db = getAdminDb();
    const [studentSnap, teacherSnap, assignmentSnap, ownerProfileSnap] = await Promise.all([
      db.collection('student_profiles').doc(uid).get(),
      db.collection('teacher_profiles').doc(uid).get(),
      db.collection('assignments').doc(assignmentId).get(),
      // uid di path = akun anonim perangkat yang mengunggah. Siswa yang sama
      // di perangkat/login lain punya uid berbeda tapi studentId sama.
      db.collection('student_profiles').doc(ownerUid).get(),
    ]);

    if (!assignmentSnap.exists || assignmentSnap.data()?.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Lampiran tidak ditemukan.' }, { status: 404 });
    }

    const student = studentSnap.data();
    const teacher = teacherSnap.data();
    const isOwnerStudent =
      studentSnap.exists &&
      ownerProfileSnap.exists &&
      !!student?.studentId &&
      (uid === ownerUid ||
        (ownerProfileSnap.data()?.studentId === student.studentId &&
          ownerProfileSnap.data()?.workspaceId === workspaceId)) &&
      student?.workspaceId === workspaceId &&
      student?.className === assignmentSnap.data()?.className;
    const isWorkspaceTeacher = teacherSnap.exists && teacher?.workspaceId === workspaceId;

    if (!isOwnerStudent && !isWorkspaceTeacher) {
      return NextResponse.json({ error: 'Anda tidak memiliki akses ke lampiran ini.' }, { status: 403 });
    }

    const { url, key } = supabaseConfig();
    const response = await fetch(
      `${url}/storage/v1/object/sign/${BUCKET}/${encodedPath(path)}`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      logger.error('submission_sign.supabase_failed', { upstreamStatus: response.status, detail: await response.text().catch(() => '') });
      return NextResponse.json({ error: 'Lampiran belum bisa dibuka. Coba lagi.' }, { status: 502 });
    }

    const result = await response.json();
    const signedURL = result.signedURL || result.signedUrl;
    if (typeof signedURL !== 'string' || !signedURL) {
      return NextResponse.json({ error: 'Tautan sementara tidak berhasil dibuat.' }, { status: 502 });
    }

    const absoluteURL = signedURL.startsWith('http')
      ? signedURL
      : `${url}/storage/v1${signedURL.startsWith('/') ? signedURL : `/${signedURL}`}`;
    return NextResponse.json({ signedUrl: absoluteURL, expiresIn: SIGNED_URL_TTL_SECONDS });
  } catch (error) {
    // Validasi body (parseBody) dan penolakan disengaja: pesan aman + status-nya.
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SupabaseConfigError) {
      logger.error('submission_sign.config_missing');
      return NextResponse.json({ error: 'Penyimpanan lampiran belum dikonfigurasi. Hubungi gurumu.', code: 'server_config' }, { status: 503 });
    }
    logger.error('submission_sign.failed', { err: error });
    return NextResponse.json({ error: 'Lampiran belum bisa dibuka. Coba lagi.' }, { status: 500 });
  }
}
