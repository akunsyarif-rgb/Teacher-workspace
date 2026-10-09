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

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Konfigurasi penyimpanan Supabase belum lengkap.');
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

  let uid: string;
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: 'Sesi tidak valid. Silakan masuk kembali.' }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const workspaceId = form.get('workspaceId');
    const assignmentId = form.get('assignmentId');
    const file = form.get('file');
    const contentType = form.get('contentType');

    if (typeof workspaceId !== 'string' || !workspaceId || typeof assignmentId !== 'string' || !assignmentId) {
      return NextResponse.json({ error: 'Data tugas tidak valid.' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File lampiran tidak ditemukan.' }, { status: 400 });
    }
    if (file.size <= 0 || file.size >= MAX_FILE_BYTES) {
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

    // Tegakkan tenggat dan status penilaian sebelum menerima file, agar
    // endpoint upload tidak bisa dipakai mengumpulkan setelah ditutup atau
    // mengunggah lampiran yatim untuk tugas yang sudah dikunci guru.
    const existingSubmissionSnap = await db.collection('submissions').doc(`${assignmentId}_${student.studentId}`).get();
    const gate = canStudentSubmit(existingSubmissionSnap.exists ? existingSubmissionSnap.data() : null, assignment?.dueDate);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason }, { status: 409 });
    }

    const { url, key } = supabaseConfig();
    const fileName = safeName(file.name);
    const path = `submissions/${workspaceId}/${assignmentId}/${uid}/${randomUUID()}_${fileName}`;
    const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodedPath(path)}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: await file.arrayBuffer(),
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('Supabase submission upload failed:', response.status, await response.text().catch(() => ''));
      return NextResponse.json({ error: 'Foto belum berhasil disimpan. Coba lagi setelah koneksi stabil.' }, { status: 502 });
    }

    // URL stabil ini bukan tautan publik. File hanya dapat dibuka lewat
    // endpoint penandatangan yang memverifikasi sesi Firebase dan hak akses.
    return NextResponse.json({
      fileUrl: `supabase-storage://${BUCKET}/${path}`,
      fileName: file.name,
      filePath: path,
    });
  } catch (error) {
    console.error('Submission upload error:', error);
    return NextResponse.json({ error: 'Upload belum berhasil. Periksa koneksi dan coba lagi.' }, { status: 500 });
  }
}
