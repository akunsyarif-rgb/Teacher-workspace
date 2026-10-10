import { isSupabaseCollection } from '../config/dataBackend';

// Akses Supabase dari server (route handler Next.js). Dua mode, sengaja dipisah:
//  - userRequest : memakai ID token Firebase pengguna → RLS & RPC berlaku sebagai pengguna itu (join, daftar anggota, keluarkan guru).
//  - serviceRequest : secret key (service_role, bypass RLS) → HANYA untuk Panel Pemilik Aplikasi lintas-workspace dan pencarian
//    workspace saat rename kelas; pemanggil wajib sudah memverifikasi izin sendiri (assertAppOwner / token terverifikasi).
// Project SmadaExam selalu ditolak. Secret key tidak pernah dikirim ke klien.
const SMADA_REF = 'abdkrhmxfpcmgzsxzfyz';

export class SupabaseServerError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'SupabaseServerError';
  }
}

/** Identitas guru + workspace berjalan di Supabase? (unit identitas aktif). */
export const identityOnSupabase = () => isSupabaseCollection('teacher_profiles') && isSupabaseCollection('workspaces');

function baseUrl() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const ref = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!ref) throw new SupabaseServerError('Konfigurasi Supabase server belum lengkap (SUPABASE_URL).', 503);
  if (ref === SMADA_REF) throw new SupabaseServerError('Target Supabase tidak diizinkan.', 503);
  return url;
}

async function call(path: string, init: RequestInit, headers: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${baseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...((init.headers as Record<string, string>) ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!res.ok) {
    const b = (body && typeof body === 'object' ? body : {}) as { message?: string; code?: string };
    throw new SupabaseServerError(String(b.message ?? `HTTP ${res.status}`).slice(0, 200), res.status, b.code);
  }
  return body;
}

export async function userRequest(idToken: string, path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch) {
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!idToken || !publishable) throw new SupabaseServerError('Konfigurasi Supabase server belum lengkap.', 503);
  return call(path, init, { apikey: publishable, Authorization: `Bearer ${idToken}` }, fetchImpl);
}

export async function serviceRequest(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new SupabaseServerError('Konfigurasi Supabase server belum lengkap (SUPABASE_SECRET_KEY).', 503);
  return call(path, init, { apikey: key, Authorization: `Bearer ${key}` }, fetchImpl);
}
