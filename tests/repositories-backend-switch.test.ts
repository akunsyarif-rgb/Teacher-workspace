import { beforeEach, describe, expect, it, vi } from 'vitest';

// Lima repository yang bisa dialihkan: default Firestore, Supabase hanya bila koleksinya dicantumkan di flag.
const fs = vi.hoisted(() => ({ getDocuments: vi.fn(), getDocument: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn(), batchWrite: vi.fn(), countDocuments: vi.fn(), generateId: vi.fn(() => 'gid'), getDocumentFromCache: vi.fn(), setDocument: vi.fn(), serverTimestamp: vi.fn(() => ({ sentinel: true })) }));
const sb = vi.hoisted(() => ({ getDocuments: vi.fn(), getDocument: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn(), batchWrite: vi.fn(), countDocuments: vi.fn(), generateId: vi.fn(() => 'gid'), getDocumentFromCache: vi.fn(), setDocument: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/adapters/firestoreAdapter', () => fs);
vi.mock('../lib/adapters/supabaseClient', () => ({ getSupabaseAdapter: () => sb }));

const UNIT_FLAG = 'students,student_login_codes,student_profiles';
const IDENTITY_CASES = [
  { collection: 'teacher_profiles', mod: 'teacherProfileRepository', run: (r: Record<string, (...a: unknown[]) => Promise<unknown>>) => [r.getTeacherProfile('u'), r.getCachedTeacherProfile('u'), r.saveTeacherProfile('u', { name: 'x' }), r.setTeacherWorkspace('u', 'w', 'OWNER'), r.updateTeacherQuickNote('u', 'n')] },
  { collection: 'workspaces', mod: 'workspaceRepository', run: (r: Record<string, (...a: unknown[]) => Promise<unknown>>) => [r.getWorkspaceById('w'), r.getCachedWorkspaceById('w'), r.createWorkspaceDoc({ name: 'S', plan: 'school_annual', ownerUid: 'u', classLimit: 3, inviteCode: 'ABC123', inviteCodeExpiresAt: 1 }), r.updateWorkspaceInviteCode('w', 'ZZZ999', 2)] },
];
const CASES: { collection: string; mod: string; run: (r: Record<string, (...a: unknown[]) => Promise<unknown>>) => Promise<unknown>[] }[] = [
  { collection: 'academic_years', mod: 'academicYearRepository', run: (r) => [r.listByWorkspace('w'), r.getActive('w'), r.create({ workspaceId: 'w' }), r.update('i', { label: 'x' })] },
  { collection: 'class_fund_transactions', mod: 'classFundRepository', run: (r) => [r.getTransactions('w', '7A'), r.createTransaction({ workspaceId: 'w' }), r.deleteTransaction('i')] },
  { collection: 'class_inventory', mod: 'inventoryRepository', run: (r) => [r.getItems('w', '7A'), r.createItem({ workspaceId: 'w' }), r.updateItem('i', {}), r.deleteItem('i')] },
  { collection: 'student_notes', mod: 'studentNoteRepository', run: (r) => [r.getNotes('w', '7A', 'konseling'), r.createNote({ workspaceId: 'w' }), r.deleteNote('i')] },
  { collection: 'schedules', mod: 'scheduleRepository', run: (r) => [r.getAllSchedules('w'), r.getSchedulesByClass('w', '7A'), r.createSchedule('w', { day: 'Senin' }), r.deleteSchedule('i')] },
  { collection: 'grade_columns', mod: 'gradeColumnRepository', run: (r) => [r.getColumnsByClass('w', '7A'), r.createColumn({ workspaceId: 'w' }), r.updateColumnTitle('i', 't'), r.deleteColumn('i')] },
  { collection: 'grades', mod: 'gradeRepository', run: (r) => [r.getGradesByClass('w', '7A'), r.getGradesByStudent('w', 's'), r.saveGradesBatch('w', '7A', [{ studentId: 's', columnId: 'c', score: '80' }])] },
  { collection: 'student_achievements', mod: 'achievementRepository', run: (r) => [r.getAchievementsByClass('w', '7A'), r.getAchievementsByStudent('w', 's'), r.createAchievement({ workspaceId: 'w' }), r.deleteAchievement('i'), r.copyFromNotes([{ id: 'n', workspaceId: 'w' }])] },
  { collection: 'journals', mod: 'journalRepository', run: (r) => [r.getJournalsByClass('w', '7A'), r.getJournalsByClassInRange('w', '7A', '2026-10-01', '2026-10-31'), r.findTodayJournal('w', '7A', null, '2026-10-09'), r.createJournal({ workspaceId: 'w' }), r.updateJournal('i', {}), r.deleteJournal('i')] },
  { collection: 'attendances', mod: 'attendanceRepository', run: (r) => [r.getAttendanceByClass('w', '7A'), r.getAttendanceByClassInRange('w', '7A', 'a', 'b'), r.findTodayAttendance('w', '7A', null, 'd'), r.createAttendance({ workspaceId: 'w' }), r.updateAttendance('i', {}), r.deleteAttendance('i')] },
  { collection: 'announcements', mod: 'announcementRepository', run: (r) => [r.getAnnouncementsByClass('w', '7A'), r.createAnnouncement({ workspaceId: 'w' }), r.deleteAnnouncement('i')] },
  { collection: 'assignments', mod: 'assignmentRepository', run: (r) => [r.getAssignmentsByClass('w', '7A'), r.createAssignment({ workspaceId: 'w' }), r.updateAssignment('i', {}), r.deleteAssignment('i')] },
  { collection: 'submissions', mod: 'submissionRepository', run: (r) => [r.getSubmissionsByAssignment('w', 'a'), r.getSubmission('a', 's'), r.getSubmissionsByStudent('w', 's'), r.upsertSubmission('a', 's', { workspaceId: 'w' })] },
  { collection: 'assignments', mod: 'analyticsRepository', run: (r) => [r.getAssignmentsInWorkspace('w')] },
  { collection: 'submissions', mod: 'analyticsRepository', run: (r) => [r.getSubmissionsInWorkspace('w')] },
  { collection: 'journals', mod: 'dashboardRepository', run: (r) => [r.getJournalsInRange('w', 'a', 'b'), r.getJournalCount('w')] },
  { collection: 'attendances', mod: 'dashboardRepository', run: (r) => [r.getAttendancesInRange('w', 'a', 'b')] },
  { collection: 'schedules', mod: 'dashboardRepository', run: (r) => [r.getAllSchedulesForSummary('w')] },
  { collection: 'session_skip_reasons', mod: 'sessionSkipReasonRepository', run: (r) => [r.getByDate('w', 'd'), r.createSkipReason({ workspaceId: 'w' }), r.updateSkipReason('i', {})] },
];

async function load(mod: string, flagIn: string, studentAuth = 'yes', identity = true) {
  vi.resetModules();
  // Koleksi data di Supabase mensyaratkan unit identitas (workspaces + teacher_profiles) aktif + auth guru terverifikasi.
  const flag = flagIn && identity && !flagIn.includes('workspaces') ? `${flagIn},workspaces,teacher_profiles` : flagIn;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_TEACHER_AUTH_VERIFIED', identity ? 'yes' : '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_COLLECTIONS', flag);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE', 'yes'); // Preview/uji: aturan satu-jendela produksi diuji di data-backend.test
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED', studentAuth);
  return (await import(`../lib/repositories/${mod}.ts`)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
}
beforeEach(() => {
  for (const m of [...Object.values(fs), ...Object.values(sb)]) m.mockReset().mockResolvedValue([]);
  fs.generateId.mockReturnValue('gid'); sb.generateId.mockReturnValue('gid'); fs.serverTimestamp.mockReturnValue({ sentinel: true });
});

describe.each(CASES)('$mod ($collection)', ({ collection, mod, run }) => {
  it('default: seluruh operasi ke Firestore, Supabase tidak tersentuh', async () => {
    await Promise.all(run(await load(mod, '')));
    expect(Object.values(fs).some((m) => m.mock.calls.length > 0)).toBe(true);
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
    for (const m of Object.values(fs)) for (const call of m.mock.calls) if (typeof call[0] === 'string') expect(call[0]).toBe(collection);
  });
  it('flag koleksi lain: tetap Firestore', async () => {
    await Promise.all(run(await load(mod, 'teacher_profiles,workspaces')));
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
  });
  it('flag koleksi ini: seluruh operasi ke Supabase, Firestore tidak tersentuh; query selalu memuat workspaceId', async () => {
    await Promise.all(run(await load(mod, collection)));
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
    for (const call of sb.getDocuments.mock.calls) expect((call[1] as unknown[][]).some((f) => f[0] === 'workspaceId')).toBe(true);
  });
  it('kegagalan Supabase merambat (tidak jatuh ke Firestore, tidak ditelan)', async () => {
    for (const m of Object.values(sb)) m.mockRejectedValue(new Error('gagal-sb'));
    const results = await Promise.allSettled(run(await load(mod, collection)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
  });
});

// Koleksi siswa-facing: flag saja TIDAK cukup tanpa verifikasi auth siswa → tetap Firestore.
describe.each(CASES.filter((c) => ['schedules', 'grade_columns', 'grades', 'student_achievements', 'announcements', 'assignments', 'attendances', 'submissions'].includes(c.collection)))(
  'gerbang siswa: $mod ($collection)', ({ collection, mod, run }) => {
    it('flag tanpa STUDENT_AUTH_VERIFIED → tetap Firestore', async () => {
      await Promise.all(run(await load(mod, collection, '')));
      for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
      expect(Object.values(fs).some((m) => m.mock.calls.length > 0)).toBe(true);
    });
  });

describe('studentRepository (unit students + student_login_codes)', () => {
  const ops = (s: Record<string, (...a: unknown[]) => Promise<unknown>>) => [
    s.createStudent('w', { name: 'Budi', nis: '1', className: '7A' }),
    s.createStudentsBatch('w', [{ name: 'A', nis: '1', className: '7A' }]),
    s.getAllStudents('w'),
    s.getStudentsByClass('w', '7A'),
  ];
  it('default: Firestore (batch satu kali untuk siswa + kode)', async () => {
    await Promise.all(ops(await load('studentRepository', '')));
    expect(fs.batchWrite).toHaveBeenCalled();
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
  });
  it('unit lengkap + auth siswa: SEMUA ke Supabase, batch memuat kedua koleksi dalam SATU panggilan atomik', async () => {
    await Promise.all(ops(await load('studentRepository', UNIT_FLAG)));
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
    const first = sb.batchWrite.mock.calls[0][0] as { collectionName: string }[];
    expect(first.map((o) => o.collectionName).sort()).toEqual(['student_login_codes', 'students']);
  });
  it('hanya students dicantumkan (tanpa unit) → tetap Firestore, tidak terpecah', async () => {
    await Promise.all(ops(await load('studentRepository', 'students')));
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
    expect(fs.batchWrite).toHaveBeenCalled();
  });
});

describe('dataArchive / dataCleanup mengikuti flag per koleksi lifecycle', () => {
  const range = { startDate: '2026-10-01', endDate: '2026-10-31' };
  it('default: Firestore; filter rentang dan workspace dipertahankan', async () => {
    const arch = await load('dataArchiveRepository', '');
    await arch.countLifecycleData('w', range as never);
    for (const call of fs.getDocuments.mock.calls) expect((call[1] as unknown[][]).some((f) => f[0] === 'workspaceId')).toBe(true);
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
    expect(fs.getDocuments).toHaveBeenCalledTimes(5);
  });
  it('hanya koleksi berflag ke Supabase; yang lain tetap Firestore (campuran tanpa kebocoran)', async () => {
    const arch = await load('dataArchiveRepository', 'journals,announcements');
    await arch.countLifecycleData('w', range as never);
    expect(sb.getDocuments.mock.calls.map((c) => c[0]).sort()).toEqual(['announcements', 'journals']);
    expect(fs.getDocuments.mock.calls.map((c) => c[0]).sort()).toEqual(['assignments', 'attendances', 'submissions']);
    const j = sb.getDocuments.mock.calls.find((c) => c[0] === 'journals')![1] as unknown[][];
    expect(j).toEqual([['workspaceId', '==', 'w'], ['date', '>=', '2026-10-01'], ['date', '<=', '2026-10-31']]);
  });
  it('cleanup: daftar yang dihapus = daftar yang dihitung, dikirim ke backend koleksi itu saja', async () => {
    sb.getDocuments.mockResolvedValue([{ id: 'j1' }, { id: 'j2' }]);
    const clean = await load('dataCleanupRepository', 'journals');
    expect(await clean.deleteLifecycleData('journals', 'w', range as never)).toBe(2);
    expect(sb.batchWrite).toHaveBeenCalledWith([
      { type: 'delete', collectionName: 'journals', id: 'j1' },
      { type: 'delete', collectionName: 'journals', id: 'j2' },
    ]);
    expect(fs.batchWrite).not.toHaveBeenCalled();
    fs.getDocuments.mockResolvedValue([{ id: 'a1' }]);
    await clean.deleteLifecycleData('assignments', 'w', range as never);
    expect(fs.batchWrite).toHaveBeenCalledWith([{ type: 'delete', collectionName: 'assignments', id: 'a1' }]);
  });
  it('kegagalan Supabase pada Arsip merambat (tidak ada fallback ke Firestore)', async () => {
    sb.getDocuments.mockRejectedValue(new Error('gagal-sb'));
    const arch = await load('dataArchiveRepository', 'journals');
    await expect(arch.countLifecycleData('w', range as never)).rejects.toThrow('gagal-sb');
  });
});

describe.each(IDENTITY_CASES)('identitas: $mod ($collection)', ({ collection, mod, run }) => {
  const load2 = async (flag: string, teacher = 'yes') => { const m = await load(mod, flag, 'yes', false); void teacher; return m; };
  it('default: Firestore', async () => {
    await Promise.all(run(await load2('')));
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
    expect(Object.values(fs).some((m) => m.mock.calls.length > 0)).toBe(true);
  });
  it('unit identitas lengkap + auth guru terverifikasi → Supabase, Firestore tidak tersentuh (kecuali sentinel waktu)', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_COLLECTIONS', 'workspaces,teacher_profiles');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_TEACHER_AUTH_VERIFIED', 'yes');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE', 'yes');
    const r = (await import(`../lib/repositories/${mod}.ts`)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    await Promise.all(run(r));
    // serverTimestamp() hanya pembuat sentinel (bukan I/O); dibuang oleh adapter Supabase.
    for (const [name, m] of Object.entries(fs)) if (name !== 'serverTimestamp') expect(m, name).not.toHaveBeenCalled();
    expect(Object.values(sb).some((m) => m.mock.calls.length > 0)).toBe(true);
  });
  it('hanya salah satu dari unit identitas, atau tanpa TEACHER_AUTH_VERIFIED → tetap Firestore', async () => {
    for (const [flag, teacher] of [[collection, 'yes'], ['workspaces,teacher_profiles', '']] as const) {
      for (const m of [...Object.values(fs), ...Object.values(sb)]) m.mockReset();
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_COLLECTIONS', flag);
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_TEACHER_AUTH_VERIFIED', teacher);
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE', 'yes');
      const r = (await import(`../lib/repositories/${mod}.ts`)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
      await Promise.all(run(r));
      for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
    }
  });
});

describe('koleksi data tanpa unit identitas di Supabase → tetap Firestore (RLS bergantung pada teacher_profiles)', () => {
  it.each(CASES.slice(0, 6))('$collection', async ({ collection, mod, run }) => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_COLLECTIONS', collection);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_TEACHER_AUTH_VERIFIED', 'yes');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED', 'yes');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE', 'yes');
    const r = (await import(`../lib/repositories/${mod}.ts`)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
    await Promise.all(run(r));
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
  });
});
