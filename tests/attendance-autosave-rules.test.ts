import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp, type Firestore } from 'firebase/firestore';

// Alur auto-save presensi guru (create → update → tandai selesai) di bawah aturan sungguhan, termasuk dokumen LAMA
// tanpa createdBy dan dokumen buatan guru lain di workspace yang sama.
let testEnv: RulesTestEnvironment;
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-teacher-workspace',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: 'localhost', port: 8080 },
  });
});
afterAll(async () => testEnv.cleanup());
afterEach(async () => testEnv.clearFirestore());

const asDb = (ctx: { firestore(): unknown }) => ctx.firestore() as unknown as Firestore;
const payload = (extra: Record<string, unknown> = {}) => ({
  workspaceId: 'ws1', className: 'XI-A', subject: 'PAI', date: '2026-11-12',
  summary: { hadir: 1, sakit: 0, izin: 0, dispensasi: 0, alpa: 0, terlambat: 0 },
  details: [{ studentId: 's1', name: 'Budi', nis: '1', status: 'Hadir', late: false }], scheduleId: null, ...extra,
});

async function seedTeacher(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(asDb(ctx), `teacher_profiles/${uid}`), { workspaceId: 'ws1', role: 'TEACHER' });
  });
}

describe('auto-save presensi di bawah firestore.rules', () => {
  it('buat (dengan createdBy) → ubah → tandai selesai: semua lolos', async () => {
    await seedTeacher('t1');
    const db = asDb(testEnv.authenticatedContext('t1'));
    const ref = await assertSucceeds(addDoc(collection(db, 'attendances'), { ...payload(), createdBy: 't1', createdAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, payload({ subject: 'PAI 2' })));
    await assertSucceeds(updateDoc(ref, { completed: true }));
  });

  it('dokumen LAMA tanpa createdBy (createdAt string) tetap bisa diubah guru workspace', async () => {
    await seedTeacher('t1');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(asDb(ctx), 'attendances/old1'), { ...payload(), createdAt: '2026-11-01T01:00:00Z' });
    });
    const db = asDb(testEnv.authenticatedContext('t1'));
    await assertSucceeds(updateDoc(doc(db, 'attendances/old1'), payload({ subject: 'Revisi' })));
    await assertSucceeds(updateDoc(doc(db, 'attendances/old1'), { completed: true }));
  });

  it('dokumen buatan guru lain di workspace yang sama bisa diubah (kolaborasi)', async () => {
    await seedTeacher('t1');
    await seedTeacher('t2');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(asDb(ctx), 'attendances/by2'), { ...payload(), createdBy: 't2', createdAt: serverTimestamp() });
    });
    await assertSucceeds(updateDoc(doc(asDb(testEnv.authenticatedContext('t1')), 'attendances/by2'), payload({ subject: 'X' })));
  });

  it('klien LAMA (tanpa createdBy saat membuat) ditolak — penyebab "Missing or insufficient permissions"', async () => {
    await seedTeacher('t1');
    const db = asDb(testEnv.authenticatedContext('t1'));
    await assertFails(addDoc(collection(db, 'attendances'), { ...payload(), createdAt: serverTimestamp() }));
  });
});
