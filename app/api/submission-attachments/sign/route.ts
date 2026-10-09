import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';

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
  const authHeader = request.headers.get('authorization') || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });

  // Inisialisasi Admin SDK dipisah dari verifikasi token: env var service
  // account yang hilang bukan "sesi tidak valid" milik siswa, jadi tidak
  // boleh disamarkan sebagai 401.
  let adminAuth: ReturnType<typeof getAdminAuth>;
  try {
    adminAuth = getAdminAuth();
  } catch (error) {
    console.error('Firebase Admin tidak dapat diinisialisasi:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Server belum dikonfigurasi untuk unggah lampiran. Hubungi gurumu.', code: 'server_config' },
      { status: 503 }
    );
  }

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid;
  } catch (error) {
    console.error('Verifikasi token Firebase gagal:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Sesi tidak valid. Silakan masuk kembali.', code: 'invalid_token' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const path = body?.filePath;
    if (typeof path !== 'string') {
      return NextResponse.json({ error: 'Path lampiran tidak valid.' }, { status: 400 });
    }

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
    const [studentSnap, teacherSnap, assignmentSnap] = await Promise.all([
      db.collection('student_profiles').doc(uid).get(),
      db.collection('teacher_profiles').doc(uid).get(),
      db.collection('assignments').doc(assignmentId).get(),
    ]);

    if (!assignmentSnap.exists || assignmentSnap.data()?.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Lampiran tidak ditemukan.' }, { status: 404 });
    }

    const student = studentSnap.data();
    const teacher = teacherSnap.data();
    const isOwnerStudent =
      studentSnap.exists &&
      uid === ownerUid &&
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
      console.error('Supabase signed URL failed:', response.status, await response.text().catch(() => ''));
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
    if (error instanceof SupabaseConfigError) {
      console.error('Env Supabase (URL / SECRET_KEY) tidak tersedia saat runtime.');
      return NextResponse.json({ error: 'Penyimpanan lampiran belum dikonfigurasi. Hubungi gurumu.', code: 'server_config' }, { status: 503 });
    }
    console.error('Submission signed URL error:', error);
    return NextResponse.json({ error: 'Lampiran belum bisa dibuka. Coba lagi.' }, { status: 500 });
  }
}
