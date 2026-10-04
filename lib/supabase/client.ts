import { auth } from '@/src/config/firebase';

/**
 * Minimal Supabase REST client.
 *
 * Teacher Workspace tetap menggunakan Firebase Auth sebagai identity provider.
 * Supabase menerima Firebase ID token sebagai Bearer token setelah Third-Party
 * Auth Firebase diaktifkan pada project Workflow.
 *
 * Sengaja tidak memakai @supabase/supabase-js pada fase bridge agar dependency
 * baru tidak masuk ke bundle sebelum repository aplikasi benar-benar dipindah.
 */
export async function getSupabaseAccessToken(forceRefresh = false): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi Firebase belum tersedia.');
  return user.getIdToken(forceRefresh);
}

export async function supabaseRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!baseUrl || !publishableKey) {
    throw new Error('Konfigurasi Supabase belum tersedia.');
  }

  const token = await getSupabaseAccessToken(false);
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/v1/${path.replace(/^\//, '')}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase request gagal (${response.status}): ${body || response.statusText}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
