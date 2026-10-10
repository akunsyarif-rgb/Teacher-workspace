import type { IdentitySink } from './ulanganIdentitySync';

// Penulis service_role DIBATASI: hanya dua tabel proyeksi, kolom konflik yang diizinkan, dan bentuk filter hapus yang tertutup.
// Tujuannya mencegah secret key dipakai untuk apa pun selain proyeksi identitas, sekalipun ada bug di pemanggil.
const TABLES = new Set(['ulh_members', 'ulh_roster']);
const CONFLICT: Record<string, string> = { ulh_members: 'user_id', ulh_roster: 'workspace_id,student_id' };
const FILTERS: Record<string, RegExp> = {
  ulh_members: /^user_id=eq\.[A-Za-z0-9%._~-]{1,600}$/,
  ulh_roster: /^workspace_id=eq\.[A-Za-z0-9%._~-]{1,600}&synced_at=lt\.[A-Za-z0-9%._~-]{1,80}$/,
};
export const MAX_ROWS_PER_REQUEST = 500;

export type ServiceRequest = (path: string, init?: RequestInit) => Promise<unknown>;

export function createIdentitySink(request: ServiceRequest): IdentitySink {
  return {
    async upsert(table, rows, onConflict) {
      if (!TABLES.has(table) || CONFLICT[table] !== onConflict) throw new Error('sink: tabel/kolom tidak diizinkan');
      if (!rows.length) return;
      if (rows.length > MAX_ROWS_PER_REQUEST) throw new Error('sink: terlalu banyak baris');
      await request(`${table}?on_conflict=${onConflict}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
    },
    async remove(table, filter) {
      if (!TABLES.has(table) || !FILTERS[table].test(filter)) throw new Error('sink: filter tidak diizinkan');
      await request(`${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    },
  };
}
