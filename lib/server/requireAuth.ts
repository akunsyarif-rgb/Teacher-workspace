import { NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminAuth } from './firebaseAdmin';

// Satu-satunya tempat token Bearer Firebase diverifikasi untuk route /api.
// Sebelumnya logika ini disalin di 11 route dan tidak seragam (hanya backup
// yang memeriksa pencabutan sesi). Default `checkRevoked: true`: token dari
// sesi yang sudah dicabut (ganti sandi, keluarkan guru, logout semua perangkat)
// ditolak. Biayanya satu panggilan ke Firebase Auth per request.
export type AuthFailureCode = 'no_token' | 'invalid_token' | 'server_config';

export class AuthFailure extends Error {
  status: number;
  code: AuthFailureCode;
  // Kode galat Firebase (mis. auth/id-token-revoked) — hanya untuk log/diagnosa, bukan token.
  firebaseCode: string;
  constructor(code: AuthFailureCode, firebaseCode = '') {
    super(code);
    this.code = code;
    this.status = code === 'server_config' ? 503 : 401;
    this.firebaseCode = firebaseCode;
  }
}

export type AuthOptions = {
  /** Default true. Matikan hanya dengan alasan tertulis (mis. autosave ujian berfrekuensi tinggi). */
  checkRevoked?: boolean;
  /** Pesan 503 bila Firebase Admin belum dikonfigurasi (tanpa detail internal). */
  configErrorMessage?: string;
  /** Header tambahan pada respons gagal (mis. Cache-Control: no-store). */
  headers?: Record<string, string>;
};

export type AuthedUser = { uid: string; token: DecodedIdToken };

export function extractBearerToken(request: Request): string {
  return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

// Versi yang melempar AuthFailure — untuk route yang menyusun bentuk respons error sendiri.
export async function authenticate(request: Request, options: AuthOptions = {}): Promise<AuthedUser> {
  const idToken = extractBearerToken(request);
  if (!idToken) throw new AuthFailure('no_token');

  let auth: ReturnType<typeof getAdminAuth>;
  try {
    auth = getAdminAuth();
  } catch (error) {
    // Detail (mis. env service account kosong) hanya ke log, tidak ke client.
    console.error('Firebase Admin tidak dapat diinisialisasi:', error instanceof Error ? error.message : error);
    throw new AuthFailure('server_config');
  }

  try {
    const token = await auth.verifyIdToken(idToken, options.checkRevoked ?? true);
    return { uid: token.uid, token };
  } catch (error) {
    const firebaseCode = String((error as { code?: unknown } | null)?.code ?? '').replace(/[^a-z0-9_/-]/gi, '').slice(0, 50);
    throw new AuthFailure('invalid_token', firebaseCode);
  }
}

const MESSAGES: Record<AuthFailureCode, string> = {
  no_token: 'Token otentikasi diperlukan.',
  invalid_token: 'Sesi tidak valid. Silakan masuk kembali.',
  server_config: 'Server belum dikonfigurasi. Hubungi admin.',
};

export function authFailureResponse(failure: AuthFailure, options: AuthOptions = {}): NextResponse {
  const message = failure.code === 'server_config' ? options.configErrorMessage ?? MESSAGES.server_config : MESSAGES[failure.code];
  return NextResponse.json({ error: message, code: failure.code }, { status: failure.status, headers: options.headers });
}

// Pola umum di route: `const auth = await requireAuth(request); if (auth instanceof NextResponse) return auth;`
export async function requireAuth(request: Request, options: AuthOptions = {}): Promise<AuthedUser | NextResponse> {
  try {
    return await authenticate(request, options);
  } catch (error) {
    if (error instanceof AuthFailure) return authFailureResponse(error, options);
    throw error;
  }
}
