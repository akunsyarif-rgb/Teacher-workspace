import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import { uploadBufferToDrive } from '@/lib/adapters/googleDriveAdapter';
import { resolveUploadContentType } from '@/lib/utils/uploadFileTypes';

// Butuh Node.js runtime (googleapis + firebase-admin) — bukan Edge.
export const runtime = 'nodejs';

// Vercel Serverless Function membatasi body request Route Handler ke
// ±4.5 MB — jauh di bawah batas 10 MB yang dipakai jalur Firebase Storage
// (lib/utils/uploadFileTypes.ts, storageAdapter.ts). Ini batas platform,
// bukan sesuatu yang bisa dilonggarkan dari kode. File lebih besar dari
// ini TETAP harus lewat Firebase Storage (upload langsung dari client,
// tidak pernah melalui server) — jalur Drive ini cuma opsi kedua untuk
// file yang cukup kecil.
const MAX_DRIVE_UPLOAD_BYTES = 4 * 1024 * 1024;

// Di bawah batas durasi default function Vercel (60 dtk di plan Hobby)
// supaya request yang macet dilaporkan jelas ke client, bukan dipotong
// paksa oleh platform tanpa pesan.
const UPLOAD_TIMEOUT_MS = 55_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(message), { code: 'app/timeout' }));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

type Kind = 'submission' | 'material';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!idToken) {
      return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });
    }

    // uid HARUS dari token yang diverifikasi, bukan dari form field —
    // supaya kepemilikan workspace/kelas ditentukan dari identitas asli
    // pemanggil, tidak bisa dipalsukan lewat body request. Sama seperti
    // pola di app/api/classes/rename/route.ts.
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const formData = await request.formData();
    const file = formData.get('file');
    const workspaceId = String(formData.get('workspaceId') || '').trim();
    const assignmentId = String(formData.get('assignmentId') || '').trim();
    const kindRaw = String(formData.get('kind') || '').trim();

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'File tidak ditemukan pada request.' }, { status: 400 });
    }
    if (!workspaceId || !assignmentId || (kindRaw !== 'submission' && kindRaw !== 'material')) {
      return NextResponse.json({ error: 'Data upload tidak lengkap.' }, { status: 400 });
    }
    const kind = kindRaw as Kind;

    const adminDb = getAdminDb();

    // Drive tidak kenal konsep workspaceId/className Firestore — jadi
    // pemeriksaan di bawah ini menggantikan peran firestore.rules/
    // storage.rules untuk jalur upload ini. Dibaca lewat Admin SDK
    // (bypass rules) karena route ini SENDIRI yang jadi penjaganya.
    const [teacherSnap, studentSnap] = await Promise.all([
      adminDb.collection('teacher_profiles').doc(uid).get(),
      adminDb.collection('student_profiles').doc(uid).get(),
    ]);
    const teacherProfile = teacherSnap.exists ? (teacherSnap.data() as { workspaceId?: string }) : null;
    const studentProfile = studentSnap.exists
      ? (studentSnap.data() as { workspaceId?: string; className?: string })
      : null;

    const authorized =
      kind === 'material'
        ? !!teacherProfile && teacherProfile.workspaceId === workspaceId
        : !!studentProfile && studentProfile.workspaceId === workspaceId;
    if (!authorized) {
      return NextResponse.json({ error: 'Anda tidak punya akses untuk mengunggah ke tugas ini.' }, { status: 403 });
    }

    const assignmentSnap = await adminDb.collection('assignments').doc(assignmentId).get();
    if (!assignmentSnap.exists) {
      return NextResponse.json({ error: 'Tugas tidak ditemukan.' }, { status: 404 });
    }
    const assignment = assignmentSnap.data() as { workspaceId?: string; className?: string };
    if (assignment.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Tugas ini bukan milik workspace Anda.' }, { status: 403 });
    }
    if (kind === 'submission' && assignment.className !== studentProfile?.className) {
      return NextResponse.json({ error: 'Tugas ini bukan untuk kelas Anda.' }, { status: 403 });
    }

    if (file.size >= MAX_DRIVE_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error:
            'Ukuran file maksimal 4 MB untuk jalur Google Drive. Kecilkan dulu file-nya, atau gunakan unggah foto biasa (maks 10 MB).',
        },
        { status: 413 }
      );
    }

    const uploadedFile = file as File;
    const originalName = uploadedFile.name || 'lampiran';
    const contentType = resolveUploadContentType({ name: originalName, type: uploadedFile.type });
    if (!contentType) {
      return NextResponse.json({ error: 'Format file harus gambar, PDF, atau dokumen Word.' }, { status: 400 });
    }

    const arrayBuffer = await uploadedFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await withTimeout(
      uploadBufferToDrive(buffer, originalName, contentType),
      UPLOAD_TIMEOUT_MS,
      `Unggah "${originalName}" ke Google Drive terlalu lama. Periksa koneksi internet lalu coba lagi.`
    );

    return NextResponse.json({
      provider: 'google-drive',
      fileId: result.fileId,
      fileUrl: result.webViewLink,
      fileName: result.fileName,
    });
  } catch (error: any) {
    console.error('upload ke Google Drive gagal:', error);
    if (error?.code === 'app/timeout') {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    if (error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error') {
      return NextResponse.json({ error: 'Sesi kedaluwarsa, muat ulang halaman lalu coba lagi.' }, { status: 401 });
    }
    return NextResponse.json({ error: error?.message || 'Gagal mengunggah file ke Google Drive.' }, { status: 500 });
  }
}
