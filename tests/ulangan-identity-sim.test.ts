import { describe, expect, it } from 'vitest';
import { syncUlanganIdentity, type Doc, type IdentitySink, type IdentitySources } from '../lib/server/ulanganIdentitySync';

// Simulasi berurutan dengan "Firestore" yang berubah dan proyeksi Supabase tiruan yang meniru semantik PostgREST
// (upsert merge-duplicates, hapus berfilter) DAN constraint CHECK ulh_members. Fixture realistis: sekolah dengan pemilik, guru, siswa.
function world() {
  const fs: Record<string, Doc> = {
    'workspaces/wsA': { ownerUid: 'owner' }, 'workspaces/wsB': { ownerUid: 'owner2' },
    'teacher_profiles/owner': { workspaceId: 'wsA', role: 'OWNER', name: 'Pemilik' },
    'teacher_profiles/guru': { workspaceId: 'wsA', role: 'TEACHER', name: 'Bu Guru', isActive: true },
    'student_profiles/anonSiswa': { studentId: 's1', workspaceId: 'wsA', className: '7A', name: 'Budi' },
    'students/s1': { workspaceId: 'wsA', className: '7A', name: 'Budi' },
    'students/s2': { workspaceId: 'wsA', className: '7A', name: 'Sari' },
    'students/s3': { workspaceId: 'wsA', className: '7B', name: 'Dewi' },
    'students/b1': { workspaceId: 'wsB', className: '8A', name: 'Bima' },
  };
  const members = new Map<string, Doc>();
  const roster = new Map<string, Doc>();
  let clock = 0;
  const fail = { upsert: null as null | ((t: string, n: number) => boolean), remove: null as null | ((t: string) => boolean) };
  let upsertCalls = 0;
  const src: IdentitySources = {
    getDoc: async (c, id) => (fs[`${c}/${id}`] ? { ...fs[`${c}/${id}`] } : null),
    listStudents: async (ws) => Object.entries(fs).filter(([k, v]) => k.startsWith('students/') && v.workspaceId === ws)
      .map(([k, v]) => ({ id: k.split('/')[1], className: String(v.className ?? ''), name: String(v.name ?? '') })),
  };
  const check = (m: Doc) => {
    const t = m.kind === 'teacher' && m.role && m.student_id == null;
    const s = m.kind === 'student' && m.role == null && m.student_id && m.class_name;
    if (!t && !s) throw new Error('CHECK ulh_members dilanggar');
  };
  const sink: IdentitySink = {
    async upsert(table, rows) {
      upsertCalls += 1;
      if (fail.upsert?.(table, upsertCalls)) throw new Error('putus saat upsert');
      for (const r of rows) {
        if (table === 'ulh_members') {
          const merged = { ...(members.get(String(r.user_id)) ?? {}), ...r, synced_at: ++clock }; // trigger DB: jam database
          check(merged);
          members.set(String(r.user_id), merged);
        } else {
          roster.set(`${r.workspace_id}/${r.student_id}`, { ...(roster.get(`${r.workspace_id}/${r.student_id}`) ?? {}), ...r });
        }
      }
    },
    async remove(table, filter) {
      if (fail.remove?.(table)) throw new Error('putus saat hapus');
      if (table === 'ulh_members') members.delete(decodeURIComponent(filter.replace('user_id=eq.', '')));
      else {
        const m = filter.match(/^workspace_id=eq\.([^&]+)&synced_at=lt\.(.+)$/)!;
        const ws = decodeURIComponent(m[1]); const ts = decodeURIComponent(m[2]);
        for (const [k, v] of roster) if (v.workspace_id === ws && String(v.synced_at) < ts) roster.delete(k);
      }
    },
  };
  let t = 0;
  const now = () => new Date(Date.UTC(2026, 9, 10, 10, 0, ++t)); // waktu aplikasi monoton
  const sync = (uid: string, roster = false) => syncUlanganIdentity({ uid, roster, now }, src, sink);
  return { fs, members, roster, sync, fail, resetCalls: () => { upsertCalls = 0; } };
}
const classes = (roster: Map<string, Doc>, ws: string) => [...roster.values()].filter((r) => r.workspace_id === ws).map((r) => `${r.student_id}:${r.class_name}`).sort();

describe('simulasi sinkronisasi identitas (fixture sekolah)', () => {
  it('guru aktif → nonaktif → aktif lagi; pemilik; tak dikenal tidak mendapat apa pun', async () => {
    const w = world();
    expect(await w.sync('guru')).toEqual({ kind: 'teacher' });
    expect(await w.sync('owner')).toEqual({ kind: 'teacher' });
    expect(w.members.get('guru')).toMatchObject({ role: 'TEACHER', workspace_id: 'wsA' });
    w.fs['teacher_profiles/guru'].isActive = false;
    expect(await w.sync('guru')).toEqual({ kind: null });
    expect(w.members.has('guru')).toBe(false);
    w.fs['teacher_profiles/guru'].isActive = true;
    expect(await w.sync('guru')).toEqual({ kind: 'teacher' });
    expect(await w.sync('orangAsing')).toEqual({ kind: null });
    expect(w.members.has('orangAsing')).toBe(false);
  });

  it('perubahan workspace guru ikut terbawa; roster workspace lama tidak ikut berubah', async () => {
    const w = world();
    await w.sync('owner', true);
    await w.sync('guru');
    expect(classes(w.roster, 'wsA')).toEqual(['s1:7A', 's2:7A', 's3:7B']);
    w.fs['teacher_profiles/guru'] = { workspaceId: 'wsB', role: 'TEACHER' };
    await w.sync('guru', true);
    expect(w.members.get('guru')).toMatchObject({ workspace_id: 'wsB', role: 'TEACHER' });
    expect(classes(w.roster, 'wsB')).toEqual(['b1:8A']);
    expect(classes(w.roster, 'wsA')).toEqual(['s1:7A', 's2:7A', 's3:7B']); // wsA tak tersentuh oleh sinkronisasi wsB
    // guru dikeluarkan dari workspace (field dihapus Firestore)
    delete w.fs['teacher_profiles/guru'].workspaceId;
    await w.sync('guru');
    expect(w.members.has('guru')).toBe(false);
  });

  it('perpindahan/penggantian nama kelas siswa, penghapusan siswa, dan siswa baru mengikuti Firestore', async () => {
    const w = world();
    await w.sync('owner', true);
    await w.sync('anonSiswa');
    expect(w.members.get('anonSiswa')).toMatchObject({ kind: 'student', class_name: '7A' });
    w.fs['students/s1'].className = '7B'; // pindah kelas; profil (7A) basi
    w.fs['students/s4'] = { workspaceId: 'wsA', className: '7B', name: 'Tono' }; // siswa baru
    delete w.fs['students/s2']; // siswa dihapus
    await w.sync('owner', true);
    await w.sync('anonSiswa');
    expect(w.members.get('anonSiswa')).toMatchObject({ class_name: '7B' });
    expect(classes(w.roster, 'wsA')).toEqual(['s1:7B', 's3:7B', 's4:7B']);
    delete w.fs['students/s1']; // siswa terhubung dihapus → akses dicabut pada sinkronisasi berikutnya
    await w.sync('anonSiswa');
    expect(w.members.has('anonSiswa')).toBe(false);
  });

  it('peralihan jenis akun (guru ↔ siswa) tidak melanggar constraint dan tidak meninggalkan sisa kolom', async () => {
    const w = world();
    w.fs['teacher_profiles/alih'] = { workspaceId: 'wsA', role: 'TEACHER' };
    await w.sync('alih');
    expect(w.members.get('alih')).toMatchObject({ kind: 'teacher', student_id: null, class_name: null });
    delete w.fs['teacher_profiles/alih'];
    await w.sync('alih');
    expect(w.members.has('alih')).toBe(false); // dicabut dulu bila tak ada identitas
    await w.sync('alih'); // idempoten
    w.fs['student_profiles/alih'] = { studentId: 's1', workspaceId: 'wsA' };
    await w.sync('alih');
    expect(w.members.get('alih')).toMatchObject({ kind: 'student', role: null, student_id: 's1' });
    w.fs['teacher_profiles/alih'] = { workspaceId: 'wsA', role: 'ADMIN' }; // jadi guru tanpa pencabutan di antaranya
    await w.sync('alih');
    expect(w.members.get('alih')).toMatchObject({ kind: 'teacher', role: 'ADMIN', student_id: null, class_name: null });
  });

  it('retry idempoten dan dua sinkronisasi roster paralel tidak kehilangan siswa', async () => {
    const w = world();
    await w.sync('owner', true);
    const once = JSON.stringify([...w.roster.entries()].map(([k, v]) => [k, v.class_name, v.name]).sort());
    await w.sync('owner', true);
    expect(JSON.stringify([...w.roster.entries()].map(([k, v]) => [k, v.class_name, v.name]).sort())).toBe(once);
    w.fs['students/s9'] = { workspaceId: 'wsA', className: '7C', name: 'Baru' };
    await Promise.all([w.sync('owner', true), w.sync('owner', true), w.sync('owner', true)]);
    expect(classes(w.roster, 'wsA')).toEqual(['s1:7A', 's2:7A', 's3:7B', 's9:7C']);
  });

  it('kegagalan sebagian: roster tidak dipurge sebelum semua upsert sukses; ulang berhasil memulihkan', async () => {
    const w = world();
    for (let i = 10; i < 1000; i++) w.fs[`students/x${i}`] = { workspaceId: 'wsA', className: '7A', name: `N${i}` };
    await w.sync('owner', true);
    const full = w.roster.size;
    expect(full).toBeGreaterThan(900);
    delete w.fs['students/s2'];
    w.resetCalls();
    w.fail.upsert = (table, n) => table === 'ulh_roster' && n === 3; // gagal di chunk ke-2
    await expect(w.sync('owner', true)).rejects.toThrow('putus');
    expect(w.roster.has('wsA/s2')).toBe(true); // belum dipurge (superset, bukan kehilangan)
    expect(w.roster.size).toBe(full);
    w.fail.upsert = null;
    await w.sync('owner', true);
    expect(w.roster.has('wsA/s2')).toBe(false); // setelah sukses penuh, siswa yang dihapus ikut hilang
    expect(w.roster.size).toBe(full - 1);
  });

  it('kegagalan pencabutan: galat naik (tidak diam), akses tetap sampai TTL, retry mencabut', async () => {
    const w = world();
    await w.sync('guru');
    w.fs['teacher_profiles/guru'].isActive = false;
    w.fail.remove = () => true;
    await expect(w.sync('guru')).rejects.toThrow('putus');
    expect(w.members.has('guru')).toBe(true); // baris masih ada → hanya TTL 30 menit di sisi RPC yang menutup
    w.fail.remove = null;
    await w.sync('guru');
    expect(w.members.has('guru')).toBe(false);
  });

  it('sinkronisasi roster oleh siswa/non-guru tidak pernah menulis roster; guru lain tak bisa menyentuh roster workspace asing', async () => {
    const w = world();
    await w.sync('anonSiswa', true);
    expect(w.roster.size).toBe(0);
    await w.sync('orangAsing', true);
    expect(w.roster.size).toBe(0);
    w.fs['teacher_profiles/guru'] = { workspaceId: 'wsB', role: 'TEACHER' };
    await w.sync('guru', true);
    expect([...w.roster.values()].every((r) => r.workspace_id === 'wsB')).toBe(true);
  });
});
