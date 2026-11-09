import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';

// Uji beban dan biaya: mengisi emulator dengan sekolah besar, lalu menjalankan KODE APLIKASI SUNGGUHAN (service/repository)
// untuk tiap alur pengguna sambil menghitung bacaan Firestore. Jalankan: npm run loadtest
// Skala: LOADTEST_SCALE=0.25 (cepat) … 1 (sekolah besar, bawaan). Tulis laporan: LOADTEST_OUT=docs/LOAD-TEST.md

const hoisted = vi.hoisted(() => ({
  db: null as unknown as Firestore,
  t: { reads: 0, docs: 0, bytes: 0, queries: 0 },
}));

vi.mock('@/src/config/firebase', () => ({
  get db() { return hoisted.db; },
  auth: { currentUser: null },
}));

// Hitung bacaan: 1 per dokumen yang dikembalikan (minimal 1 per query); getDoc = 1; agregasi count = 1 per 1000 entri indeks.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDocs: async (q: Parameters<typeof actual.getDocs>[0]) => {
      const snap = await actual.getDocs(q);
      hoisted.t.queries += 1;
      hoisted.t.reads += Math.max(1, snap.size);
      hoisted.t.docs += snap.size;
      hoisted.t.bytes += snap.docs.reduce((a, d) => a + JSON.stringify(d.data()).length + d.id.length, 0);
      return snap;
    },
    getDoc: async (ref: Parameters<typeof actual.getDoc>[0]) => {
      const snap = await actual.getDoc(ref);
      hoisted.t.queries += 1;
      hoisted.t.reads += 1;
      if (snap.exists()) { hoisted.t.docs += 1; hoisted.t.bytes += JSON.stringify(snap.data()).length; }
      return snap;
    },
    getCountFromServer: async (q: Parameters<typeof actual.getCountFromServer>[0]) => {
      const res = await actual.getCountFromServer(q);
      hoisted.t.queries += 1;
      hoisted.t.reads += Math.max(1, Math.ceil(res.data().count / 1000));
      return res;
    },
  };
});

import { LARGE_SCHOOL, scaled, seedSchool, type SeedResult } from './seed';
import { DEFAULT_PRICES, type Prices, type UsageProfile } from './costModel';
import { renderMarkdown, type ScenarioResult } from './report';
import { loadDashboardSummary } from '../../lib/services/dashboardService';
import { listClassSummaries, getStudentsInClass } from '../../lib/services/studentService';
import { listAttendanceHistory } from '../../lib/services/attendanceService';
import { listJournalEntries } from '../../lib/services/journalService';
import { loadGradeData } from '../../lib/services/gradeService';
import { getSubmissionsForAssignment } from '../../lib/services/submissionService';
import { loadInsights } from '../../lib/services/analyticsService';
import { loadSchedules } from '../../lib/services/scheduleService';
import * as portal from '../../lib/services/studentPortalService';
import { setPersistentStorageForTests } from '../../lib/utils/persistentCache';

const PROJECT = 'demo-loadtest';
const SCALE = Number(process.env.LOADTEST_SCALE ?? '1');
const RUNS = 3;
const num = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);

let testEnv: RulesTestEnvironment;
let seed: SeedResult;
const size = scaled(LARGE_SCHOOL, SCALE);

beforeAll(async () => {
  // Node tidak punya localStorage: pakai penyimpanan memori supaya cache perangkat (Beranda/presensi siswa) ikut teruji.
  { const m = new Map<string, string>(); setPersistentStorageForTests({ get length() { return m.size; }, key: (i: number) => Array.from(m.keys())[i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() } as Storage); }
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      host: 'localhost', port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] ?? 8080),
      rules: "rules_version = '2'; service cloud.firestore { match /databases/{d}/documents { match /{doc=**} { allow read, write: if true; } } }",
    },
  });
  hoisted.db = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
  const started = Date.now();
  seed = await seedSchool(PROJECT, size);
  console.info(`[loadtest] seed ${seed.total} dokumen dalam ${((Date.now() - started) / 1000).toFixed(0)} dtk`);
});
afterAll(async () => { await testEnv?.cleanup(); });

describe('sekolah besar', () => {
  it('mengukur alur pengguna dan menulis laporan', async () => {
    const ws = seed.workspaceId;
    const cls = seed.sampleClass;
    const scope = { workspaceId: ws, className: cls, studentId: seed.sampleStudentId };

    const scenarios: { name: string; actor: 'guru' | 'siswa'; label: string; run: () => Promise<unknown>; prime?: () => Promise<unknown>; fresh?: boolean }[] = [
      { name: 'beranda', actor: 'guru', label: 'Guru: Beranda — buka pertama (cache perangkat kosong)', run: () => loadDashboardSummary(ws), fresh: true },
      { name: 'beranda-hangat', actor: 'guru', label: 'Guru: Beranda — buka berikutnya (cache perangkat terisi)', run: () => loadDashboardSummary(ws), prime: () => loadDashboardSummary(ws) },
      { name: 'daftar-kelas', actor: 'guru', label: 'Guru: daftar kelas', run: () => listClassSummaries(ws) },
      { name: 'detail-kelas', actor: 'guru', label: 'Guru: detail kelas (siswa)', run: () => getStudentsInClass(ws, cls) },
      { name: 'riwayat-presensi', actor: 'guru', label: 'Guru: riwayat presensi satu kelas', run: () => listAttendanceHistory(ws, cls) },
      { name: 'riwayat-jurnal', actor: 'guru', label: 'Guru: riwayat jurnal satu kelas', run: () => listJournalEntries(ws, cls) },
      { name: 'nilai', actor: 'guru', label: 'Guru: tabel nilai kelas', run: () => loadGradeData(ws, cls) },
      { name: 'pengumpulan', actor: 'guru', label: 'Guru: pengumpulan satu tugas', run: () => getSubmissionsForAssignment(ws, cls, seed.sampleAssignmentId) },
      { name: 'analitik', actor: 'guru', label: 'Guru: Analitik', run: () => loadInsights(ws) },
      { name: 'jadwal', actor: 'guru', label: 'Guru: Jadwal', run: () => loadSchedules(ws) },
      { name: 'siswa-beranda', actor: 'siswa', label: 'Siswa: Beranda (pengumuman)', run: () => portal.getAnnouncements(scope) },
      { name: 'siswa-jadwal', actor: 'siswa', label: 'Siswa: Jadwal', run: () => portal.getSchedule(scope) },
      { name: 'siswa-tugas', actor: 'siswa', label: 'Siswa: Tugas', run: () => portal.getAssignments(scope) },
      { name: 'siswa-nilai', actor: 'siswa', label: 'Siswa: Nilai', run: () => portal.getGrades(scope) },
      { name: 'siswa-presensi', actor: 'siswa', label: 'Siswa: Kehadiran — buka pertama (sinkron penuh)', run: () => portal.getAttendance(scope), fresh: true },
      { name: 'siswa-presensi-hangat', actor: 'siswa', label: 'Siswa: Kehadiran — buka berikutnya (sinkron jendela 7 hari)', run: () => portal.getAttendance(scope), prime: () => portal.getAttendance(scope) },
    ];

    const results: ScenarioResult[] = [];
    for (const sc of scenarios) {
      const times: number[] = [];
      if (sc.fresh) { const m = new Map<string, string>(); setPersistentStorageForTests({ get length() { return m.size; }, key: (i: number) => Array.from(m.keys())[i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() } as Storage); }
      if (sc.prime) await sc.prime();
      let first = { reads: 0, docs: 0, bytes: 0, queries: 0 };
      for (let i = 0; i < RUNS; i++) {
        if (sc.fresh && i > 0) setPersistentStorageForTests({ get length() { return 0; }, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} } as unknown as Storage);
        hoisted.t = { reads: 0, docs: 0, bytes: 0, queries: 0 };
        const t0 = performance.now();
        await sc.run();
        times.push(performance.now() - t0);
        if (i === 0) first = { ...hoisted.t };
      }
      times.sort((a, b) => a - b);
      results.push({ name: sc.name, actor: sc.actor, label: sc.label, ...first, ms: times[Math.floor(times.length / 2)] });
      console.info(`[loadtest] ${sc.label}: ${first.reads} bacaan, ${(first.bytes / 1024).toFixed(0)} KB, ${times[1].toFixed(0)} ms`);
    }

    // Profil pemakaian harian (dapat diubah): sekolah besar 60 guru, 1.296 siswa.
    const usage: UsageProfile = {
      teachers: size.teachers, students: size.classes * size.studentsPerClass, schoolDaysPerMonth: 22, studentActiveRate: num('LOADTEST_STUDENT_ACTIVE', 0.6),
      teacherOpensPerDay: { beranda: 1, 'beranda-hangat': 7, 'daftar-kelas': 3, 'detail-kelas': 6, 'riwayat-presensi': 4, 'riwayat-jurnal': 3, nilai: 3, pengumpulan: 2, analitik: 0.5, jadwal: 2 },
      studentOpensPerDay: { 'siswa-beranda': 2, 'siswa-jadwal': 0.5, 'siswa-tugas': 1, 'siswa-nilai': 0.5, 'siswa-presensi': 0.05, 'siswa-presensi-hangat': 0.25 },
      teacherWritesPerDay: 20, studentWritesPerDay: 0.3,
    };
    const prices: Prices = { ...DEFAULT_PRICES, readPer100k: num('LOADTEST_PRICE_READ_PER_100K', DEFAULT_PRICES.readPer100k), writePer100k: num('LOADTEST_PRICE_WRITE_PER_100K', DEFAULT_PRICES.writePer100k), usdIdr: num('LOADTEST_USD_IDR', DEFAULT_PRICES.usdIdr) };

    const md = renderMarkdown({ size, totalDocs: seed.total, docsByCollection: seed.docs, results, usage, prices, networkKbps: num('LOADTEST_NETWORK_KBPS', 1500), scale: SCALE, generatedAt: new Date().toISOString().slice(0, 10) });
    console.info('\n' + md);
    if (process.env.LOADTEST_OUT) writeFileSync(process.env.LOADTEST_OUT, md + '\n');
    expect(results.length).toBe(scenarios.length);
    expect(results.every((r) => r.reads > 0)).toBe(true);
  });
});
