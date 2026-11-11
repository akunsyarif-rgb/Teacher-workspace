import { NextResponse } from 'next/server';
import type { z, ZodType } from 'zod';
import { logger } from '../utils/logger';

// Error yang AMAN ditampilkan ke client: pesannya ditulis sengaja untuk
// pengguna (validasi, kuota, kode salah) dan memuat status HTTP. Hanya
// subclass/instance ini yang pesannya boleh keluar dari route.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Semua error LAIN (SDK, konfigurasi, jaringan, bug) bisa memuat detail
// internal — mis. "FIREBASE_ADMIN_SERVICE_ACCOUNT belum di-set", pesan
// Firestore/Supabase, path. Itu dicatat di log server saja; client hanya
// menerima pesan generik + status 500.
export function errorResponse(
  error: unknown,
  fallbackMessage: string,
  logLabel: string,
  headers?: Record<string, string>
): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers });
  }
  logger.error(logLabel, { err: error });
  return NextResponse.json({ error: fallbackMessage }, { status: 500, headers });
}

// Validasi body request dengan skema Zod. Gagal -> ApiError 400 dengan pesan skema (sudah
// bahasa Indonesia) — tidak pernah membocorkan detail internal. Body bukan objek/JSON rusak
// diperlakukan sebagai {} sehingga jatuh ke pesan "wajib diisi" yang sama.
export function parseBody<S extends ZodType>(schema: S, data: unknown, fallbackMessage = 'Permintaan tidak valid.'): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const first = result.error.issues[0];
  throw new ApiError(first?.message && !/^Invalid input|^Too (big|small)|^Expected /.test(first.message) ? first.message : fallbackMessage, 400);
}
