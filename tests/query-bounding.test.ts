import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';

// Adapter + repository ASLI di atas Firestore Emulator (project terpisah): membuktikan paginasi
// (limit + startAfter), pemecahan `in`, dan pembatasan rentang tanggal benar-benar membatasi bacaan.
// Berjalan lewat `npm run test:rules`.
const hoisted = vi.hoisted(() => ({ db: null as unknown as Firestore }));
vi.mock('@/src/config/firebase', () => ({
  get db() {
    return hoisted.db;
  },
  auth: { currentUser: { uid: 'tester' } },
}));
vi.mock('../lib/adapters/serverApiAdapter', () => ({ postToServer: vi.fn() }));

import {
  getAllDocumentsPaged,
  getDocumentsPage,
  getDocumentsWhereIn,
  FIRESTORE_IN_LIMIT,
} from '../lib/adapters/firestoreAdapter';
import * as studentRepo from '../lib/repositories/studentRepository';
import * as analyticsRepo from '../lib/repositories/analyticsRepository';
import * as scheduleRepo from '../lib/repositories/scheduleRepository';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-query-bounding',
    // Project terpisah dengan rules terbuka: yang diuji di sini query adapter, bukan rules.
    firestore: {
      host: 'localhost',
      port: 8080,
      rules: "rules_version = '2'; service cloud.firestore { match /databases/{d}/documents { match /{doc=**} { allow read, write: if true; } } }",
    },
  });
  hoisted.db = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
});
afterAll(async () => testEnv.cleanup());
afterEach(async () => testEnv.clearFirestore());

async function seedMany(collectionName: string, n: number, make: (i: number) => Record<string, unknown>, prefix = 'd') {
  // writeBatch maks 500 operasi
  for (let start = 0; start < n; start += 400) {
    const batch = writeBatch(hoisted.db);
    for (let i = start; i < Math.min(start + 400, n); i++) batch.set(doc(hoisted.db, collectionName, `${prefix}${String(i).padStart(5, '0')}`), make(i));
    await batch.commit();
  }
}

describe('getDocumentsPage / getAllDocumentsPaged', () => {
  it('halaman dibatasi pageSize; cursor melanjutkan tanpa duplikat dan tanpa lompatan', async () => {
    await seedMany('students', 1250, (i) => ({ workspaceId: 'w1', className: '7A', name: `S${i}` }));
    await seedMany('students', 300, (i) => ({ workspaceId: 'w2', className: '7A', name: `X${i}` }), 'z'); // id tenant lain, tidak menimpa

    const p1 = await getDocumentsPage('students', [['workspaceId', '==', 'w1']], { pageSize: 500 });
    expect(p1.docs).toHaveLength(500);
    expect(p1.nextCursor).toBe(p1.docs[499].id);
    const p2 = await getDocumentsPage('students', [['workspaceId', '==', 'w1']], { pageSize: 500, cursor: p1.nextCursor });
    const p3 = await getDocumentsPage('students', [['workspaceId', '==', 'w1']], { pageSize: 500, cursor: p2.nextCursor });
    expect(p2.docs).toHaveLength(500);
    expect(p3.docs).toHaveLength(250);
    expect(p3.nextCursor).toBeNull(); // halaman terakhir

    const ids = [...p1.docs, ...p2.docs, ...p3.docs].map((d) => d.id);
    expect(new Set(ids).size).toBe(1250);
    expect(ids).toEqual([...ids].sort()); // urut id
    expect(p1.docs.every((d: any) => d.workspaceId === 'w1')).toBe(true); // tidak menyeberang tenant
  });

  it('pageSize dijepit 1..1000; halaman kosong -> nextCursor null', async () => {
    const empty = await getDocumentsPage('students', [['workspaceId', '==', 'kosong']], { pageSize: 99999 });
    expect(empty).toEqual({ docs: [], nextCursor: null });
  });

  it('jumlah dokumen persis kelipatan pageSize tidak membuat putaran tak berujung', async () => {
    await seedMany('students', 1000, (i) => ({ workspaceId: 'w1', className: '7A', name: `S${i}` }));
    const all = await getAllDocumentsPaged('students', [['workspaceId', '==', 'w1']], { pageSize: 500 });
    expect(all).toHaveLength(1000);
  });

  it('getAllDocumentsPaged mengembalikan semuanya (1.250) lewat 3 halaman', async () => {
    await seedMany('schedules', 1250, (i) => ({ workspaceId: 'w1', className: '7A', day: 'Senin', timeSlot: `${i}`, subject: 'IPA' }));
    const all = await scheduleRepo.getAllSchedules('w1');
    expect(all).toHaveLength(1250);
  });
});

describe('repository siswa: paginasi + soft delete', () => {
  it('getStudentsPage menyaring siswa terhapus dan memakai nextCursor (bukan panjang docs)', async () => {
    await seedMany('students', 30, (i) => ({ workspaceId: 'w1', className: i % 2 ? '7A' : '7B', name: `S${i}`, ...(i % 3 === 0 ? { deletedAt: 1 } : {}) }));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof studentRepo.getStudentsPage>> = await studentRepo.getStudentsPage('w1', { pageSize: 8, cursor });
      page.docs.forEach((d) => seen.push(d.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(4);
    expect(seen).toHaveLength(20); // 30 - 10 terhapus
    const onlyA = await studentRepo.getStudentsPage('w1', { className: '7A', pageSize: 100 });
    expect(onlyA.docs.every((d) => d.className === '7A')).toBe(true);
  });
});

describe('getDocumentsWhereIn', () => {
  it('memecah > 30 nilai ke beberapa query dan menggabungkan hasilnya tanpa duplikat', async () => {
    await seedMany('submissions', 100, (i) => ({ workspaceId: 'w1', assignmentId: `a${i}`, studentId: 's1' }));
    await seedMany('submissions', 10, (i) => ({ workspaceId: 'w2', assignmentId: `a${i}`, studentId: 's1' }), 'z');
    const ids = Array.from({ length: 75 }, (_, i) => `a${i}`);
    expect(FIRESTORE_IN_LIMIT).toBe(30);
    const rows = await getDocumentsWhereIn('submissions', [['workspaceId', '==', 'w1']], 'assignmentId', [...ids, ...ids]);
    expect(rows).toHaveLength(75);
    expect(rows.every((r: any) => r.workspaceId === 'w1')).toBe(true);
    expect(await getDocumentsWhereIn('submissions', [['workspaceId', '==', 'w1']], 'assignmentId', [])).toEqual([]);
  });
});

describe('analitik: tidak lagi mengunduh seluruh riwayat', () => {
  it('hanya tugas dengan tenggat di jendela, dan hanya pengumpulan milik tugas itu', async () => {
    // 200 tugas lama (tahun lalu) + 3 tugas di jendela; tiap tugas punya 2 pengumpulan
    await seedMany('assignments', 200, (i) => ({ workspaceId: 'w1', className: '7A', title: `Lama ${i}`, dueDate: '2025-03-01' }));
    await setDoc(doc(hoisted.db, 'assignments', 'baru1'), { workspaceId: 'w1', className: '7A', title: 'B1', dueDate: '2026-10-20' });
    await setDoc(doc(hoisted.db, 'assignments', 'baru2'), { workspaceId: 'w1', className: '7A', title: 'B2', dueDate: '2026-10-25' });
    await setDoc(doc(hoisted.db, 'assignments', 'baru3'), { workspaceId: 'w1', className: '7A', title: 'B3', dueDate: '2026-10-26', deletedAt: 1 });
    await setDoc(doc(hoisted.db, 'assignments', 'lain'), { workspaceId: 'w2', className: '7A', title: 'Lain', dueDate: '2026-10-22' });
    await seedMany('submissions', 400, (i) => ({ workspaceId: 'w1', assignmentId: i < 400 ? `d${String(i % 200).padStart(5, '0')}` : 'x', studentId: `s${i}` }));
    await setDoc(doc(hoisted.db, 'submissions', 'sb1'), { workspaceId: 'w1', assignmentId: 'baru1', studentId: 's1' });
    await setDoc(doc(hoisted.db, 'submissions', 'sb2'), { workspaceId: 'w1', assignmentId: 'baru2', studentId: 's1' });
    await setDoc(doc(hoisted.db, 'submissions', 'sb3'), { workspaceId: 'w1', assignmentId: 'baru2', studentId: 's2' });

    const assignments = await analyticsRepo.getAssignmentsDueInRange('w1', '2026-10-09', '2026-11-08');
    expect(assignments.map((a) => a.id).sort()).toEqual(['baru1', 'baru2']); // tidak ada yang lama, terhapus, atau milik tenant lain
    const subs = await analyticsRepo.getSubmissionsForAssignments('w1', assignments.map((a) => a.id));
    expect(subs.map((s) => s.id).sort()).toEqual(['sb1', 'sb2', 'sb3']); // 3 dari 403 pengumpulan
  });
});
