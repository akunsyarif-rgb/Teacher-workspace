import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import { canStudentSubmit } from '@/lib/utils/submissionRules';

export const runtime = 'nodejs';

const BUCKET = 'submission-attachments';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

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
    const { workspaceId, assignmentId, fileName, contentType, fileSize } = body ?? {};
    if (
      typeof workspaceId !== 'string' || !workspaceId ||
      typeof assignmentId !== 'string' || !assignmentId ||
      typeof fileName !== 'string' || !fileName ||
      typeof fileSize !== 'number' || !Number.isInteger(fileSize)
    ) {
      return NextResponse.json({ error: 'Data tugas atau file tidak valid.' }, { status: 400 });
    }
    if (fileSize <= 0 || fileSize >= MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Ukuran file harus kurang dari 10 MB.' }, { status: 413 });
    }
    if (typeof contentType !== 'string' || !ALLOWED_TYPES.has(contentType)) {
      return NextResponse.json({ error: 'Format file harus gambar, PDF, atau dokumen Word.' }, { status: 415 });
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
      const detail = await response.text().catch(() => '');
      console.error('Supabase signed upload URL failed:', response.status, detail);
      // Status + pesan error Supabase (mis. "Bucket not found", "Invalid JWT")
      // aman ditampilkan — tidak memuat key — dan menghilangkan tebak-tebakan.
      let upstreamMessage = '';
      try {
        const parsed = JSON.parse(detail);
        upstreamMessage = String(parsed?.message || parsed?.error || '').slice(0, 120);
      } catch {}
      return NextResponse.json(
        {
          error: `Upload belum bisa disiapkan (penyimpanan menolak: ${response.status}${upstreamMessage ? ` – ${upstreamMessage}` : ''}).`,
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
    if (error instanceof SupabaseConfigError) {
      console.error('Env Supabase (URL / SECRET_KEY) tidak tersedia saat runtime.');
      return NextResponse.json({ error: 'Penyimpanan lampiran belum dikonfigurasi. Hubungi gurumu.', code: 'server_config' }, { status: 503 });
    }
    console.error('Submission upload authorization error:', error);
    return NextResponse.json({ error: 'Upload belum bisa disiapkan. Periksa koneksi dan coba lagi.' }, { status: 500 });
  }
}
