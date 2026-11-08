import { NextResponse } from 'next/server';

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
  console.error(`${logLabel}:`, error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500, headers });
}
