import { postToServer } from '../adapters/serverApiAdapter';

// Hapus PERMANEN dari Sampah lewat server (Admin SDK): rules client tidak bisa menghapus data turunan
// (nilai, pengumpulan, lampiran, kode akses, sesi login), dan khusus OWNER/ADMIN (dicek ulang di server).
export type PurgeCountsDto = {
  students: number; assignments: number; columns: number; grades: number; submissions: number;
  achievements: number; notes: number; profiles: number; loginCodes: number; files: number;
};
export type PurgeResponse = { done: boolean; counts: PurgeCountsDto };

export type PurgeRequest = { all: true } | { kind: 'student' | 'assignment' | 'column' | 'class'; id: string };

export async function purgeOnServer(body: PurgeRequest): Promise<PurgeResponse> {
  return postToServer<PurgeResponse>('/api/trash/purge', body);
}
