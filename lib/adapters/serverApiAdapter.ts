import { auth } from '@/src/config/firebase';

// Panggilan ke route server (Admin SDK) untuk operasi yang TIDAK boleh
// ditulis langsung dari client (mis. membuat siswa: batas paket ditegakkan
// di server). Token diambil dari sesi Firebase saat ini.
export async function postToServer<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login tidak ditemukan. Muat ulang halaman lalu masuk kembali.');
  const idToken = await user.getIdToken();

  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });

  let data: any;
  try {
    data = (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new Error(data?.error || `Server menolak permintaan (HTTP ${res.status}).`);
  if (data === undefined) throw new Error('Server membalas dalam format yang tidak dikenali. Muat ulang halaman.');
  return data as T;
}
