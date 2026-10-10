import { describe, expect, it, vi } from 'vitest';
import {
  SupabaseAdapterError, buildFilterParams, createSupabaseAdapter, fromRow, toRow,
} from '../lib/adapters/supabaseAdapter';
import { isSupabaseCollection } from '../lib/config/dataBackend';
import { createFakePostgrest, type FakeOpts } from './helpers/fakePostgrest';

const C = 'session_skip_reasons';
const TOK_A = 'tok-A';
const TOK_B = 'tok-B';

function setup(over: Partial<FakeOpts> = {}, deps: Partial<Parameters<typeof createSupabaseAdapter>[0]> = {}) {
  const fake = createFakePostgrest({ tokens: { [TOK_A]: 'wsA', [TOK_B]: 'wsB' }, ...over });
  const tokens: (string | null)[] = [];
  const adapter = createSupabaseAdapter({
    url: 'https://x.supabase.co/rest/v1/',
    publishableKey: 'pk',
    getToken: async (force) => { tokens.push(force ? 'forced' : 'normal'); return deps.getToken ? deps.getToken(force) : TOK_A; },
    fetchImpl: fake.fetchImpl,
    sleep: async () => {},
    isOnline: () => true,
    ...deps,
    ...(deps.getToken ? { getToken: deps.getToken } : {}),
  });
  return { adapter, fake, tokens };
}
const skip = (over: Record<string, unknown> = {}) => ({ workspaceId: 'wsA', scheduleId: 's1', className: '7A', date: '2026-10-09', reason: 'sakit', note: 'x', ...over });
const err = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as SupabaseAdapterError;

describe('dataBackend flag', () => {
  it('default mati', () => {
    expect(isSupabaseCollection(C, undefined)).toBe(false);
    expect(isSupabaseCollection(C, '')).toBe(false);
  });
});

describe('mapping', () => {
  it('field di luar kolom masuk metadata, timestamp server dibuang', () => {
    expect(toRow(C, { workspaceId: 'w', scheduleId: 's', note: 'x', date: '2026-10-09', createdAt: {} }))
      .toEqual({ workspace_id: 'w', date: '2026-10-09', metadata: { scheduleId: 's', note: 'x' } });
  });
  it('null kolom dipertahankan (app menulis null eksplisit); metadata digabung; timestamp jadi createdAt/updatedAt', () => {
    expect(fromRow(C, { id: '1', workspace_id: 'w', class_name: null, metadata: { scheduleId: 's' }, created_at: 't', updated_at: 'u' }))
      .toEqual({ id: '1', workspaceId: 'w', className: null, scheduleId: 's', createdAt: 't', updatedAt: 'u' });
    expect(fromRow(C, { id: '1', workspace_id: 'w', metadata: null })).toEqual({ id: '1', workspaceId: 'w' });
  });
  it('filter: metadata, null, operator & nama field berbahaya, koleksi tak dipetakan', () => {
    expect(buildFilterParams(C, [['scheduleId', '==', 's']]).toString()).toContain('metadata-%3E%3EscheduleId=eq.s');
    expect(buildFilterParams(C, [['reason', '==', null]]).get('reason')).toBe('is.null');
    expect(() => buildFilterParams(C, [['date', '!=', 'x']])).toThrow(SupabaseAdapterError);
    expect(() => buildFilterParams(C, [['a;drop table x', '==', 'x']])).toThrow(SupabaseAdapterError);
    expect(() => toRow('payments', {})).toThrow(SupabaseAdapterError);
  });
});

describe('baca', () => {
  it('filter workspace wajib (isolasi tenant)', async () => {
    const { adapter } = setup();
    expect((await err(adapter.getDocuments(C, [['date', '==', 'x']]))).kind).toBe('bad_request');
    expect((await err(adapter.getDocuments(C))).kind).toBe('bad_request');
    expect((await err(adapter.countDocuments(C, []))).kind).toBe('bad_request');
  });
  it('RLS: tenant lain tidak terbaca walau id & workspaceId ditebak', async () => {
    const { adapter } = setup({ rows: [{ id: 'b1', workspace_id: 'wsB', metadata: {} }] });
    expect(await adapter.getDocuments(C, [['workspaceId', '==', 'wsB']])).toEqual([]);
    expect(await adapter.getDocument(C, 'b1')).toBeNull();
  });
  it('paginasi: >pageSize baris tidak terpotong diam-diam', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}`, workspace_id: 'wsA', metadata: {} }));
    const { adapter, fake } = setup({ rows }, { pageSize: 10 });
    const got = await adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]);
    expect(got).toHaveLength(25);
    expect(new Set(got.map((g) => g.id)).size).toBe(25);
    expect(fake.log.filter((l) => l.method === 'GET')).toHaveLength(3);
  });
  it('countDocuments memakai count=exact', async () => {
    const rows = [1, 2, 3].map((i) => ({ id: `c${i}`, workspace_id: 'wsA', metadata: {} }));
    const { adapter } = setup({ rows });
    expect(await adapter.countDocuments(C, [['workspaceId', '==', 'wsA']])).toBe(3);
  });
  it('getDocumentFromCache selalu null; generateId unik', async () => {
    const { adapter } = setup();
    expect(await adapter.getDocumentFromCache(C, 'x')).toBeNull();
    expect(adapter.generateId(C)).not.toBe(adapter.generateId(C));
  });
});

describe('tulis', () => {
  it('addDocument: bentuk {id,...data} seperti Firestore, tersimpan di kolom + metadata', async () => {
    const { adapter, fake } = setup();
    const r = await adapter.addDocument(C, skip());
    expect(r).toMatchObject({ ...skip() });
    const row = fake.store.get(r.id as string)!;
    expect(row).toMatchObject({ workspace_id: 'wsA', class_name: '7A', reason: 'sakit', metadata: { scheduleId: 's1', note: 'x' } });
  });
  it('addDocument tanpa workspaceId ditolak; ke workspace lain ditolak RLS (bukan sukses diam-diam)', async () => {
    const { adapter, fake } = setup();
    expect((await err(adapter.addDocument(C, skip({ workspaceId: '' })))).kind).toBe('bad_request');
    expect((await err(adapter.addDocument(C, skip({ workspaceId: 'wsB' })))).kind).toBe('denied');
    expect(fake.store.size).toBe(0);
  });
  it('updateDocument: gabung field, pertahankan metadata lain, kembalikan {id,...data}, workspace_id tak dikirim', async () => {
    const { adapter, fake } = setup();
    const { id } = await adapter.addDocument(C, skip());
    fake.log.length = 0;
    const r = await adapter.updateDocument(C, id as string, { reason: 'izin' });
    expect(r).toEqual({ id, reason: 'izin' });
    expect(fake.store.get(id as string)).toMatchObject({ reason: 'izin', class_name: '7A', metadata: { scheduleId: 's1', note: 'x' } });
    const patch = fake.log.find((l) => l.method === 'PATCH')!;
    expect(patch.path).toContain('updated_at=eq.');
  });
  it('updateDocument: dokumen tak ada / milik tenant lain → error, bukan sukses', async () => {
    const { adapter } = setup({ rows: [{ id: 'b1', workspace_id: 'wsB', metadata: {} }] });
    expect((await err(adapter.updateDocument(C, 'nope', { reason: 'x' }))).kind).toBe('not_found');
    expect((await err(adapter.updateDocument(C, 'b1', { reason: 'x' }))).kind).toBe('not_found');
  });
  it('updateDocument: workspaceId immutable', async () => {
    const { adapter } = setup();
    const { id } = await adapter.addDocument(C, skip());
    expect((await err(adapter.updateDocument(C, id as string, { workspaceId: 'wsB' }))).kind).toBe('bad_request');
  });
  it('updateDocument: bentrok bersamaan terdeteksi (CAS) lalu diulang, tidak menimpa metadata lain', async () => {
    let injected = false;
    const { adapter, fake } = setup();
    const { id } = await adapter.addDocument(C, skip());
    // sisipkan update pihak lain tepat setelah baca pertama
    const orig = fake.fetchImpl;
    const wrapped = (async (u: string, init?: RequestInit) => {
      const res = await orig(u, init);
      if (!injected && (init?.method ?? 'GET') === 'GET' && u.includes(`id=eq.${id}`)) {
        injected = true;
        const row = fake.store.get(id as string)!;
        fake.store.set(id as string, { ...row, metadata: { ...(row.metadata as object), note: 'DARI-LAIN' }, updated_at: fake.stamp() });
      }
      return res;
    }) as typeof fetch;
    const a2 = createSupabaseAdapter({ url: 'https://x.supabase.co', publishableKey: 'pk', getToken: async () => TOK_A, fetchImpl: wrapped, sleep: async () => {}, isOnline: () => true });
    await a2.updateDocument(C, id as string, { reason: 'izin' });
    expect(fake.store.get(id as string)).toMatchObject({ reason: 'izin', metadata: { note: 'DARI-LAIN', scheduleId: 's1' } });
  });
  it('setDocument: buat bila belum ada, gabung bila ada', async () => {
    const { adapter, fake } = setup();
    await adapter.setDocument(C, 'fixed', skip());
    await adapter.setDocument(C, 'fixed', { reason: 'izin' });
    expect(fake.store.size).toBe(1);
    expect(fake.store.get('fixed')).toMatchObject({ reason: 'izin', metadata: { scheduleId: 's1' } });
  });
  it('deleteDocument: hapus; dokumen tak ada = sukses (seperti Firestore); ditolak RLS = error', async () => {
    const { adapter, fake } = setup({ rows: [{ id: 'b1', workspace_id: 'wsB', metadata: {} }] });
    const { id } = await adapter.addDocument(C, skip());
    expect(await adapter.deleteDocument(C, id as string)).toBe(true);
    expect(fake.store.has(id as string)).toBe(false);
    expect(await adapter.deleteDocument(C, 'tidak-ada')).toBe(true);
    // baris tenant lain tidak terlihat → diperlakukan tak ada (tidak bocor, tidak terhapus)
    expect(await adapter.deleteDocument(C, 'b1')).toBe(true);
    expect(fake.store.has('b1')).toBe(true);
  });
});

describe('kegagalan', () => {
  it('offline → error offline TANPA memanggil jaringan', async () => {
    const { adapter, fake } = setup({}, { isOnline: () => false });
    const e = await err(adapter.addDocument(C, skip()));
    expect(e.kind).toBe('offline');
    expect(fake.log).toHaveLength(0);
  });
  it('jaringan putus saat TULIS → error network, tidak diulang, tidak ada fallback', async () => {
    const { adapter, fake } = setup({ intercept: ({ method }) => (method === 'POST' ? 'network' : undefined) });
    const e = await err(adapter.addDocument(C, skip()));
    expect(e.kind).toBe('network');
    expect(fake.store.size).toBe(0);
  });
  it('GET diulang untuk 5xx lalu sukses; gagal terus → error server', async () => {
    let n = 0;
    const flaky = setup({ intercept: ({ method }) => (method === 'GET' && n++ < 2 ? { status: 503, body: { message: 'x' } } : undefined) });
    expect(await flaky.adapter.getDocuments(C, [['workspaceId', '==', 'wsA']])).toEqual([]);
    const dead = setup({ intercept: () => ({ status: 500, body: { message: 'down' } }) });
    expect((await err(dead.adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]))).kind).toBe('server');
  });
  it('tulis 5xx TIDAK diulang', async () => {
    let posts = 0;
    const { adapter } = setup({ intercept: ({ method }) => { if (method === 'POST') { posts++; return { status: 502, body: {} }; } } });
    expect((await err(adapter.addDocument(C, skip()))).kind).toBe('server');
    expect(posts).toBe(1);
  });
  it('timeout → error timeout', async () => {
    const { adapter } = setup({ intercept: () => 'hang' }, { timeoutMs: 20, maxGetRetries: 0 });
    expect((await err(adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]))).kind).toBe('timeout');
  });
  it('401 → refresh token sekali lalu sukses; tetap 401 → error auth', async () => {
    const getToken = vi.fn(async (force?: boolean) => (force ? TOK_A : 'kedaluwarsa'));
    const ok = setup({}, { getToken });
    expect(await ok.adapter.getDocuments(C, [['workspaceId', '==', 'wsA']])).toEqual([]);
    expect(getToken).toHaveBeenCalledWith(true);
    const bad = setup({}, { getToken: async () => 'selalu-salah' });
    expect((await err(bad.adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]))).kind).toBe('auth');
  });
  it('tanpa login (token null) → error auth, tanpa request', async () => {
    const { adapter, fake } = setup({}, { getToken: async () => null });
    expect((await err(adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]))).kind).toBe('auth');
    expect(fake.log).toHaveLength(0);
  });
  it('penulisan 2xx tanpa baris dikembalikan tidak dianggap sukses', async () => {
    const { adapter } = setup({ intercept: ({ method }) => (method === 'POST' ? { status: 201, body: [] } : undefined) });
    expect((await err(adapter.addDocument(C, skip()))).kind).toBe('server');
  });
});

describe('batchWrite (RPC batch_write)', () => {
  const g = (id: string, over: Record<string, unknown> = {}) => ({ type: 'set' as const, collectionName: 'session_skip_reasons', id, data: { workspaceId: 'wsA', className: '7A', reason: 'x', ...over } });
  it('set + delete dalam satu panggilan; id dipertahankan; merge metadata', async () => {
    const { adapter, fake } = setup({ rows: [{ id: 'del', workspace_id: 'wsA', metadata: {} }] });
    await adapter.batchWrite([g('a', { scheduleId: 's1' }), g('b'), { type: 'delete', collectionName: C, id: 'del' }]);
    expect([...fake.store.keys()].sort()).toEqual(['a', 'b']);
    await adapter.batchWrite([g('a', { note: 'n' })]);
    expect(fake.store.get('a')).toMatchObject({ metadata: { scheduleId: 's1', note: 'n' } });
    expect(fake.log.filter((l) => l.path.startsWith('rpc/batch_write'))).toHaveLength(2);
  });
  it('>500 operasi dipecah per 500 berurutan', async () => {
    const { adapter, fake } = setup();
    await adapter.batchWrite(Array.from({ length: 1001 }, (_, i) => g(`k${i}`)));
    expect(fake.log.filter((l) => l.path.startsWith('rpc/batch_write'))).toHaveLength(3);
    expect(fake.store.size).toBe(1001);
  });
  it('workspace tenant lain → denied dan TIDAK ada yang tertulis (atomik)', async () => {
    const { adapter, fake } = setup();
    const e = await err(adapter.batchWrite([g('ok1'), g('x', { workspaceId: 'wsB' })]));
    expect(e.kind).toBe('denied');
    expect(fake.store.size).toBe(0);
  });
  it('tanpa workspaceId / koleksi tak dipetakan ditolak sebelum request; jumlah tak cocok = error', async () => {
    const { adapter, fake } = setup();
    expect((await err(adapter.batchWrite([{ type: 'set', collectionName: C, id: 'a', data: { reason: 'x' } }]))).kind).toBe('bad_request');
    expect((await err(adapter.batchWrite([{ type: 'delete', collectionName: 'payments', id: 'a' }]))).kind).toBe('bad_request');
    expect(fake.log).toHaveLength(0);
    const odd = setup({ intercept: ({ url }) => (url.pathname.endsWith('batch_write') ? { status: 200, body: 0 } : undefined) });
    expect((await err(odd.adapter.batchWrite([g('a')]))).kind).toBe('server');
  });
  it('fungsi RPC belum dipasang (404) → error jelas, bukan sukses', async () => {
    const { adapter } = setup({ intercept: ({ url }) => (url.pathname.endsWith('batch_write') ? { status: 404, body: { code: 'PGRST202', message: 'not found' } } : undefined) });
    expect((await err(adapter.batchWrite([g('a')]))).kind).toBe('not_found');
  });
  it('nilai grades dibaca sebagai string seperti Firestore', () => {
    expect(fromRow('grades', { id: 'g', workspace_id: 'w', score: 85 })).toMatchObject({ score: '85' });
    expect(fromRow('grades', { id: 'g', workspace_id: 'w', score: null })).toMatchObject({ score: null });
  });
});

describe('operator rentang', () => {
  const J = 'journals';
  const mk = (id: string, date: string, extra: Record<string, unknown> = {}) => ({ id, workspace_id: 'wsA', class_name: '7A', date, metadata: {}, ...extra });
  it('>= dan <= pada kolom date menjadi parameter berulang (AND) dan membatasi hasil', async () => {
    const { adapter, fake } = setup({ rows: [mk('j1', '2026-09-30'), mk('j2', '2026-10-01'), mk('j3', '2026-10-15'), mk('j4', '2026-10-31'), mk('j5', '2026-11-01'), { ...mk('j6', '2026-10-10'), workspace_id: 'wsB' }] });
    const got = await adapter.getDocuments(J, [['workspaceId', '==', 'wsA'], ['date', '>=', '2026-10-01'], ['date', '<=', '2026-10-31']]);
    expect(got.map((g) => g.id)).toEqual(['j2', 'j3', 'j4']);
    const url = fake.log.find((l) => l.method === 'GET')!.path;
    expect(url).toContain('date=gte.2026-10-01');
    expect(url).toContain('date=lte.2026-10-31');
  });
  it('> dan < ; rentang pada field metadata; rentang timestamp ISO (submitted_at)', async () => {
    const { adapter } = setup({ rows: [mk('a', '2026-10-01', { metadata: { n: '5' } }), mk('b', '2026-10-02', { metadata: { n: '7' } })] });
    expect((await adapter.getDocuments(J, [['workspaceId', '==', 'wsA'], ['date', '>', '2026-10-01']])).map((x) => x.id)).toEqual(['b']);
    expect((await adapter.getDocuments(J, [['workspaceId', '==', 'wsA'], ['date', '<', '2026-10-02']])).map((x) => x.id)).toEqual(['a']);
    const sub = setup({ rows: [{ id: 's1', workspace_id: 'wsA', submitted_at: '2026-10-31T10:00:00.000Z', metadata: {} }, { id: 's2', workspace_id: 'wsA', submitted_at: '2026-11-02T00:00:00.000Z', metadata: {} }] });
    expect((await sub.adapter.getDocuments('submissions', [['workspaceId', '==', 'wsA'], ['submittedAt', '<=', '2026-10-31T23:59:59.999Z']])).map((x) => x.id)).toEqual(['s1']);
  });
  it('rentang + paginasi + count memakai filter yang sama', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => mk(`r${String(i).padStart(2, '0')}`, `2026-10-${String(i + 1).padStart(2, '0')}`));
    const { adapter } = setup({ rows }, { pageSize: 10 });
    const f: [string, string, unknown][] = [['workspaceId', '==', 'wsA'], ['date', '>=', '2026-10-06']];
    expect(await adapter.getDocuments(J, f)).toHaveLength(20);
    expect(await adapter.countDocuments(J, f)).toBe(20);
  });
  it('rentang dengan null / operator tak dikenal ditolak', () => {
    expect(() => buildFilterParams(J, [['date', '>=', null]])).toThrow(SupabaseAdapterError);
    expect(() => buildFilterParams(J, [['date', '!=', 'x']])).toThrow(SupabaseAdapterError);
    expect(() => buildFilterParams(J, [['date', 'in', ['x']]])).toThrow(SupabaseAdapterError);
  });
  it('student_profiles memakai user_id sebagai kunci dan hanya-baca', async () => {
    const { adapter, fake } = setup({ rows: [{ id: 'u1', user_id: 'u1', workspace_id: 'wsA', student_id: 's1', class_name: '7A', name: 'Budi', nis: '1', metadata: {} }] });
    expect(await adapter.getDocument('student_profiles', 'u1')).toMatchObject({ id: 'u1', workspaceId: 'wsA', studentId: 's1', className: '7A' });
    expect(fake.log[0].path).toContain('user_id=eq.u1');
    for (const run of [
      () => adapter.addDocument('student_profiles', { workspaceId: 'wsA' }),
      () => adapter.updateDocument('student_profiles', 'u1', { name: 'x' }),
      () => adapter.deleteDocument('student_profiles', 'u1'),
      () => adapter.batchWrite([{ type: 'delete', collectionName: 'student_profiles', id: 'u1' }]),
    ]) expect((await err(run())).kind).toBe('bad_request');
  });
  it('kode login: kolom code ikut diisi dari id (batch & set); rpc divalidasi namanya', async () => {
    const { adapter, fake } = setup();
    await adapter.batchWrite([{ type: 'set', collectionName: 'student_login_codes', id: 'ABC123', data: { workspaceId: 'wsA', studentId: 's1', className: '7A', name: 'Budi', nis: '1' } }]);
    expect(fake.store.get('ABC123')).toMatchObject({ code: 'ABC123', student_id: 's1', class_name: '7A' });
    expect((await err(adapter.rpc('x; drop table y', {}))).kind).toBe('bad_request');
  });
});

describe('identitas: teacher_profiles & workspaces', () => {
  const TP = 'teacher_profiles';
  const WS = 'workspaces';
  const idSetup = (rows: Record<string, unknown>[] = []) => setup({
    rows,
    visible: (r, ws) => r.workspace_id === ws || r.id === ws || r.user_id === ws || r.owner_uid === ws, // token 'tok-A' = pengguna 'wsA' pada uji identitas
    canInsert: (r, ws) => r.user_id === ws || r.owner_uid === ws,
  });
  const profile = { user_id: 'wsA', workspace_id: null, role: null, name: 'Bu Ani', homeroom_class_name: null, email: null, metadata: { subject: 'IPA', quickNote: 'catatan', isActive: true }, updated_at: 'u1' };

  it('baca profil: kunci user_id; metadata (subject, quickNote, isActive) dikembalikan di level atas', async () => {
    const { adapter, fake } = idSetup([profile]);
    expect(await adapter.getDocument(TP, 'wsA')).toMatchObject({ id: 'wsA', name: 'Bu Ani', subject: 'IPA', quickNote: 'catatan', isActive: true, workspaceId: null, role: null });
    expect(fake.log[0].path).toContain('user_id=eq.wsA');
  });
  it('profil baru TANPA workspaceId boleh dibuat (insert memakai user_id, tanpa kolom id)', async () => {
    const { adapter, fake } = idSetup();
    await adapter.setDocument(TP, 'wsA', { name: 'Bu Ani' });
    expect(fake.store.get('wsA')).toMatchObject({ user_id: 'wsA', name: 'Bu Ani' });
    expect('id' in fake.store.get('wsA')!).toBe(false);
  });
  it('klaim workspace SEKALI: profil tanpa workspace boleh diisi workspaceId + role; kemudian tidak boleh pindah', async () => {
    const { adapter, fake } = idSetup([profile]);
    await adapter.updateDocument(TP, 'wsA', { workspaceId: 'wsX', role: 'OWNER', isActive: true });
    expect(fake.store.get('wsA')).toMatchObject({ workspace_id: 'wsX', role: 'OWNER' });
    expect((await err(adapter.updateDocument(TP, 'wsA', { workspaceId: 'wsY' }))).kind).toBe('bad_request');
    await adapter.updateDocument(TP, 'wsA', { name: 'Ani Baru' }); // tidak menyentuh workspace
    expect(fake.store.get('wsA')).toMatchObject({ workspace_id: 'wsX', name: 'Ani Baru' });
  });
  it('update catatan cepat tidak menghapus metadata lain', async () => {
    const { adapter, fake } = idSetup([profile]);
    await adapter.updateDocument(TP, 'wsA', { quickNote: 'baru' });
    expect(fake.store.get('wsA')).toMatchObject({ metadata: { subject: 'IPA', quickNote: 'baru', isActive: true } });
  });
  it('daftar/hitung teacher_profiles & workspaces dari klien dilarang', async () => {
    const { adapter } = idSetup();
    for (const c of [TP, WS]) {
      expect((await err(adapter.getDocuments(c, [['workspaceId', '==', 'w']]))).kind).toBe('bad_request');
      expect((await err(adapter.countDocuments(c, [['workspaceId', '==', 'w']]))).kind).toBe('bad_request');
    }
  });
  it('workspace: dibuat dengan ownerUid; kolom dipetakan; kode undangan bisa diganti; ownerUid immutable', async () => {
    const { adapter, fake } = idSetup();
    const id = adapter.generateId(WS);
    await adapter.setDocument(WS, id, { name: 'SMA 1', plan: 'school_annual', ownerUid: 'wsA', classLimit: 3, seatLimit: 1, inviteCode: 'ABC234', inviteCodeExpiresAt: 1760000000000, createdAt: { sentinel: true } });
    expect(fake.store.get(id)).toMatchObject({ name: 'SMA 1', plan: 'school_annual', owner_uid: 'wsA', class_limit: 3, seat_limit: 1, invite_code: 'ABC234', invite_code_expires_at: 1760000000000 });
    expect('workspace_id' in fake.store.get(id)!).toBe(false);
    await adapter.updateDocument(WS, id, { inviteCode: 'ZZZ999', inviteCodeExpiresAt: 1760000999999 });
    expect(fake.store.get(id)).toMatchObject({ invite_code: 'ZZZ999', owner_uid: 'wsA' });
    expect(await adapter.getDocument(WS, id)).toMatchObject({ id, ownerUid: 'wsA', classLimit: 3, seatLimit: 1, inviteCode: 'ZZZ999' });
    expect((await err(adapter.updateDocument(WS, id, { ownerUid: 'orangLain' }))).kind).toBe('bad_request');
    expect((await err(adapter.setDocument(WS, adapter.generateId(WS), { name: 'tanpa pemilik' }))).kind).toBe('bad_request');
  });
});
