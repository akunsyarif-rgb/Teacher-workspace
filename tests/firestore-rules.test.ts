import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

// Test keamanan firestore.rules lewat Firestore Emulator (bukan Firestore
// asli — tidak butuh kredensial/project sungguhan). Fokus pada invariant
// paling kritis: isolasi antar-workspace dan pembatasan data sensitif
// (catatan konseling siswa) — dua hal yang kalau bocor, dampaknya besar
// dan diam-diam (tidak akan ketahuan dari testing manual biasa).
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-teacher-workspace',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

async function seed(fn: (db: import('firebase/firestore').Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

async function seedProfile(
  uid: string,
  workspaceId: string | null,
  role: 'OWNER' | 'ADMIN' | 'TEACHER' = 'TEACHER',
  homeroomClassName?: string
) {
  await seed((db) =>
    setDoc(doc(db, `teacher_profiles/${uid}`), {
      workspaceId,
      role,
      ...(homeroomClassName ? { homeroomClassName } : {}),
    })
  );
}

describe('teacher_profiles', () => {
  it('allows a user to create their own profile with workspaceId null', async () => {
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(setDoc(doc(db, 'teacher_profiles/teacherA'), { workspaceId: null, role: 'OWNER' }));
  });

  it('denies creating a profile for someone else', async () => {
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(setDoc(doc(db, 'teacher_profiles/teacherB'), { workspaceId: null }));
  });

  it('denies a stranger from reading another user\'s profile', async () => {
    await seedProfile('teacherA', 'ws1');
    const db = testEnv.authenticatedContext('teacherB').firestore();
    await assertFails(getDoc(doc(db, 'teacher_profiles/teacherA')));
  });

  it('allows OWNER/ADMIN to read profiles in their own workspace', async () => {
    await seedProfile('owner1', 'ws1', 'OWNER');
    await seedProfile('teacherB', 'ws1', 'TEACHER');
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(getDoc(doc(db, 'teacher_profiles/teacherB')));
  });

  it('lets a user set workspaceId from null to a real value when joining a workspace', async () => {
    await seedProfile('teacherA', null, 'OWNER');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(updateDoc(doc(db, 'teacher_profiles/teacherA'), { workspaceId: 'ws1' }));
  });

  it('lets a brand new user create their profile directly with a real workspaceId (signup flow: create workspace right after signup, no prior null-profile step)', async () => {
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'teacher_profiles/teacherA'), { workspaceId: 'ws1', role: 'OWNER' }, { merge: true })
    );
  });

  it('denies changing workspaceId once it has already been set (locked after first join)', async () => {
    await seedProfile('teacherA', 'ws1', 'OWNER');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(updateDoc(doc(db, 'teacher_profiles/teacherA'), { workspaceId: 'ws2' }));
  });

  it('allows updating unrelated fields without touching workspaceId', async () => {
    await seedProfile('teacherA', 'ws1', 'OWNER');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(updateDoc(doc(db, 'teacher_profiles/teacherA'), { quickNote: 'catatan' }));
  });
});

describe('workspaces', () => {
  it('allows creating a workspace when ownerUid matches the caller', async () => {
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'teacherA', name: 'Sekolah A' }));
  });

  it('denies creating a workspace claiming someone else as owner', async () => {
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'someoneElse', name: 'Sekolah A' }));
  });

  it('never allows deleting a workspace', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'teacherA', name: 'Sekolah A' }));
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(deleteDoc(doc(db, 'workspaces/ws1')));
  });
});

// students, schedules, journals, attendances, grades, grade_columns semua
// pakai pola isolasi workspace yang identik — dites sekaligus lewat loop
// supaya tidak duplikasi, tapi tetap menguji tiap koleksi satu per satu.
const WORKSPACE_SCOPED_COLLECTIONS = [
  'students',
  'schedules',
  'journals',
  'attendances',
  'grades',
  'grade_columns',
  'assignments',
];

describe.each(WORKSPACE_SCOPED_COLLECTIONS)('%s — isolasi workspace', (collectionName) => {
  it('allows creating a document that belongs to your own workspace', async () => {
    await seedProfile('teacherA', 'ws1');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(setDoc(doc(db, `${collectionName}/doc1`), { workspaceId: 'ws1', name: 'data' }));
  });

  it('denies creating a document claiming a different workspace than your own', async () => {
    await seedProfile('teacherA', 'ws1');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(setDoc(doc(db, `${collectionName}/doc1`), { workspaceId: 'ws2', name: 'data' }));
  });

  it('denies reading a document that belongs to another workspace', async () => {
    await seedProfile('teacherA', 'ws1');
    await seed((db) => setDoc(doc(db, `${collectionName}/doc2`), { workspaceId: 'ws2', name: 'data' }));
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(getDoc(doc(db, `${collectionName}/doc2`)));
  });

  it('denies unauthenticated access entirely', async () => {
    await seed((db) => setDoc(doc(db, `${collectionName}/doc1`), { workspaceId: 'ws1', name: 'data' }));
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `${collectionName}/doc1`)));
  });
});

describe.each(['class_fund_transactions', 'class_inventory'])('%s — hanya wali kelas boleh tulis', (collectionName) => {
  it('lets anyone in the workspace read (transparency)', async () => {
    await seedProfile('teacherA', 'ws1');
    await seed((db) => setDoc(doc(db, `${collectionName}/doc1`), { workspaceId: 'ws1', className: 'XI-A', amount: 1000 }));
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(getDoc(doc(db, `${collectionName}/doc1`)));
  });

  it('denies create from a teacher who is not homeroom of that class', async () => {
    await seedProfile('teacherA', 'ws1', 'TEACHER', 'XI-B');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(setDoc(doc(db, `${collectionName}/doc1`), { workspaceId: 'ws1', className: 'XI-A', amount: 1000 }));
  });

  it('allows create from the homeroom teacher of that class', async () => {
    await seedProfile('teacherA', 'ws1', 'TEACHER', 'XI-A');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(setDoc(doc(db, `${collectionName}/doc1`), { workspaceId: 'ws1', className: 'XI-A', amount: 1000 }));
  });

  it('denies update/delete from a teacher who is not homeroom of that class', async () => {
    await seedProfile('teacherA', 'ws1', 'TEACHER', 'XI-A');
    await seedProfile('teacherB', 'ws1', 'TEACHER', 'XI-B');
    await seed((db) => setDoc(doc(db, `${collectionName}/doc1`), { workspaceId: 'ws1', className: 'XI-A', amount: 1000 }));
    const db = testEnv.authenticatedContext('teacherB').firestore();
    await assertFails(updateDoc(doc(db, `${collectionName}/doc1`), { amount: 2000 }));
    await assertFails(deleteDoc(doc(db, `${collectionName}/doc1`)));
  });
});

describe('student_notes — data sensitif (konseling), tidak untuk seluruh workspace', () => {
  it('lets the homeroom teacher of that class read notes', async () => {
    await seedProfile('teacherA', 'ws1', 'TEACHER', 'XI-A');
    await seed((db) => setDoc(doc(db, 'student_notes/n1'), { workspaceId: 'ws1', className: 'XI-A', note: 'rahasia' }));
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(getDoc(doc(db, 'student_notes/n1')));
  });

  it('lets an ADMIN/OWNER of the workspace read notes even if not homeroom', async () => {
    await seedProfile('owner1', 'ws1', 'OWNER');
    await seed((db) => setDoc(doc(db, 'student_notes/n1'), { workspaceId: 'ws1', className: 'XI-A', note: 'rahasia' }));
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(getDoc(doc(db, 'student_notes/n1')));
  });

  it('denies a regular teacher in the same workspace who is NOT homeroom of that class', async () => {
    await seedProfile('teacherB', 'ws1', 'TEACHER', 'XI-B');
    await seed((db) => setDoc(doc(db, 'student_notes/n1'), { workspaceId: 'ws1', className: 'XI-A', note: 'rahasia' }));
    const db = testEnv.authenticatedContext('teacherB').firestore();
    await assertFails(getDoc(doc(db, 'student_notes/n1')));
  });

  it('denies create from a non-homeroom teacher', async () => {
    await seedProfile('teacherB', 'ws1', 'TEACHER', 'XI-B');
    const db = testEnv.authenticatedContext('teacherB').firestore();
    await assertFails(setDoc(doc(db, 'student_notes/n1'), { workspaceId: 'ws1', className: 'XI-A', note: 'rahasia' }));
  });
});

async function seedStudentProfile(uid: string, studentId: string, workspaceId: string, className: string) {
  await seed((db) =>
    setDoc(doc(db, `student_profiles/${uid}`), { studentId, workspaceId, className, name: 'Siswa' })
  );
}

describe('student_login_codes — klaim akun Student Companion', () => {
  it('lets any authenticated user get a code by its exact id (needed before a student has any profile)', async () => {
    await seed((db) => setDoc(doc(db, 'student_login_codes/ABC123'), { studentId: 's1', workspaceId: 'ws1' }));
    const db = testEnv.authenticatedContext('studentA').firestore();
    await assertSucceeds(getDoc(doc(db, 'student_login_codes/ABC123')));
  });

  it('denies unauthenticated access', async () => {
    await seed((db) => setDoc(doc(db, 'student_login_codes/ABC123'), { studentId: 's1', workspaceId: 'ws1' }));
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'student_login_codes/ABC123')));
  });

  it('lets a teacher create a login code for a student in their own workspace', async () => {
    await seedProfile('teacherA', 'ws1');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(setDoc(doc(db, 'student_login_codes/ABC123'), { studentId: 's1', workspaceId: 'ws1' }));
  });

  it('denies a teacher creating a login code claiming a different workspace', async () => {
    await seedProfile('teacherA', 'ws1');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(setDoc(doc(db, 'student_login_codes/ABC123'), { studentId: 's1', workspaceId: 'ws2' }));
  });
});

describe('student_profiles — identitas akun siswa', () => {
  it('lets a student create their own profile (claiming an access code)', async () => {
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'student_profiles/studentUidA'), {
        studentId: 's1',
        workspaceId: 'ws1',
        className: 'XI-A',
        name: 'Budi',
      })
    );
  });

  it('denies creating a profile document for a different uid', async () => {
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      setDoc(doc(db, 'student_profiles/studentUidB'), {
        studentId: 's1',
        workspaceId: 'ws1',
        className: 'XI-A',
        name: 'Budi',
      })
    );
  });

  it('denies a stranger from reading another student\'s profile', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidB').firestore();
    await assertFails(getDoc(doc(db, 'student_profiles/studentUidA')));
  });

  it('denies updating a profile once created (identity is locked after claim)', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(updateDoc(doc(db, 'student_profiles/studentUidA'), { className: 'XI-B' }));
  });
});

describe('Student Companion — akses baca data akademik dibatasi kelas/milik sendiri', () => {
  it('lets a student read schedules for their own class', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) => setDoc(doc(db, 'schedules/sc1'), { workspaceId: 'ws1', className: 'XI-A' }));
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(getDoc(doc(db, 'schedules/sc1')));
  });

  it('denies a student reading schedules for a different class', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) => setDoc(doc(db, 'schedules/sc1'), { workspaceId: 'ws1', className: 'XI-B' }));
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDoc(doc(db, 'schedules/sc1')));
  });

  it('denies a student reading schedules from a different workspace entirely', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) => setDoc(doc(db, 'schedules/sc1'), { workspaceId: 'ws2', className: 'XI-A' }));
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDoc(doc(db, 'schedules/sc1')));
  });

  it('lets a student read their own grades', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) => setDoc(doc(db, 'grades/g1'), { workspaceId: 'ws1', studentId: 's1', score: '90' }));
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(getDoc(doc(db, 'grades/g1')));
  });

  it('denies a student reading a classmate\'s grades', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) => setDoc(doc(db, 'grades/g1'), { workspaceId: 'ws1', studentId: 's2', score: '90' }));
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDoc(doc(db, 'grades/g1')));
  });

  it('denies an unclaimed anonymous user (no student_profiles doc) from reading anything student-scoped', async () => {
    await seed((db) => setDoc(doc(db, 'schedules/sc1'), { workspaceId: 'ws1', className: 'XI-A' }));
    const db = testEnv.authenticatedContext('unclaimedAnon').firestore();
    await assertFails(getDoc(doc(db, 'schedules/sc1')));
  });
});

describe('submissions — siswa hanya boleh baca/tulis submission miliknya sendiri', () => {
  it('lets a teacher in the workspace read any submission (for grading)', async () => {
    await seedProfile('teacherA', 'ws1');
    await seed((db) =>
      setDoc(doc(db, 'submissions/sub1'), { workspaceId: 'ws1', assignmentId: 'a1', studentId: 's1', status: 'menunggu_penilaian' })
    );
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(getDoc(doc(db, 'submissions/sub1')));
  });

  it('lets a student create their own submission with status menunggu_penilaian', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'submissions/a1_s1'), {
        workspaceId: 'ws1',
        assignmentId: 'a1',
        studentId: 's1',
        status: 'menunggu_penilaian',
        textAnswer: 'jawaban saya',
      })
    );
  });

  it('denies a student creating a submission on behalf of another student', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      setDoc(doc(db, 'submissions/a1_s2'), {
        workspaceId: 'ws1',
        assignmentId: 'a1',
        studentId: 's2',
        status: 'menunggu_penilaian',
      })
    );
  });

  it('denies a student setting their own submission status straight to dinilai', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      setDoc(doc(db, 'submissions/a1_s1'), {
        workspaceId: 'ws1',
        assignmentId: 'a1',
        studentId: 's1',
        status: 'dinilai',
      })
    );
  });

  it('denies a student reading a classmate\'s submission', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'submissions/a1_s2'), { workspaceId: 'ws1', assignmentId: 'a1', studentId: 's2', status: 'menunggu_penilaian' })
    );
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDoc(doc(db, 'submissions/a1_s2')));
  });

  it('denies a student re-submitting once the teacher already graded it', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'submissions/a1_s1'), { workspaceId: 'ws1', assignmentId: 'a1', studentId: 's1', status: 'dinilai' })
    );
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      updateDoc(doc(db, 'submissions/a1_s1'), { status: 'menunggu_penilaian', textAnswer: 'revisi' })
    );
  });
});
