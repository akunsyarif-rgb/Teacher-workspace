import { auth } from './firebase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const SUPABASE_SUBMISSION_BUCKET = 'submission-attachments';

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Konfigurasi Supabase belum lengkap. Hubungi administrator aplikasi.');
  }
  return { url: SUPABASE_URL, key: SUPABASE_KEY };
}

async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi tidak valid, coba muat ulang halaman.');
  return user.getIdToken(false);
}

export async function supabaseRequest<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<{ data: T; response: Response }> {
  const { url, key } = requireConfig();
  const token = await getAuthToken();
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${url}${path}`, { ...init, headers, cache: 'no-store' });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: unknown }).message)
        : `Supabase request gagal (${response.status}).`;
    throw Object.assign(new Error(message), {
      status: response.status,
      code: typeof data === 'object' && data !== null && 'code' in data ? (data as { code?: unknown }).code : undefined,
    });
  }

  return { data: data as T, response };
}

export async function uploadSupabaseObject(path: string, file: File, contentType: string) {
  const { url, key } = requireConfig();
  const token = await getAuthToken();
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `${url}/storage/v1/object/${SUPABASE_SUBMISSION_BUCKET}/${encodedPath}`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: file,
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    const text = await response.text();
    let message = `Upload lampiran gagal (${response.status}).`;
    try {
      const body = JSON.parse(text) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      if (text) message = text;
    }
    throw Object.assign(new Error(message), { status: response.status });
  }

  return { path };
}

export function getSupabaseStorageUrl(path: string) {
  const { url } = requireConfig();
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${url}/storage/v1/object/authenticated/${SUPABASE_SUBMISSION_BUCKET}/${encodedPath}`;
}
