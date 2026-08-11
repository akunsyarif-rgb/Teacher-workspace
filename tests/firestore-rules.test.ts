import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where } from 'firebase/firestore';

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
  // ctx.firestore() dideklarasikan bertipe firebase.firestore.Firestore (API
  // namespaced/compat) di @firebase/rules-unit-testing, tapi objek yang
  // benar-benar dikembalikan saat runtime kompatibel dengan modular SDK
  // (terbukti dari seluruh test file ini memanggil doc/setDoc/dst modular ke
  // objek ini dan lolos) — murni ketidaktepatan deklarasi tipe di paket
  // tersebut, bukan ketidakcocokan runtime.
  await testEnv.withSecurityRulesDisabled(async (ctx) =>
    fn(ctx.firestore() as unknown as import('firebase/firestore').Firestore)
  );
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
  it('allows a user to create their own profile with workspaceId null (no role yet)', async () => {
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(setDoc(doc(db, 'teacher_profiles/teacherA'), { workspaceId: null }));
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
    // Audit T1/T2: role diverifikasi balik ke workspace sungguhan, jadi
    // workspace-nya harus benar ada & dimiliki teacherA supaya klaim
    // role 'OWNER' (dari seed) tetap sah saat workspaceId diisi.
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'teacherA', name: 'Sekolah A' }));
    await seedProfile('teacherA', null, 'OWNER');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(updateDoc(doc(db, 'teacher_profiles/teacherA'), { workspaceId: 'ws1' }));
  });

  it('lets a brand new user create their profile directly with a real workspaceId (signup flow: create workspace right after signup, no prior null-profile step)', async () => {
    // Sesuai alur nyata (workspaceService.createIndividualWorkspace): dokumen
    // workspaces dibuat DULU (dengan ownerUid = uid ini), baru teacher_profiles
    // ditulis merujuk ke situ — audit T1 mensyaratkan role 'OWNER' dicek balik
    // ke workspace sungguhan, bukan dipercaya dari body request.
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'teacherA', name: 'Sekolah A' }));
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

  it('lets the owner update unrelated fields like name or invite code', async () => {
    await seed((db) =>
      setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'teacherA', name: 'Sekolah A', plan: 'individual_lifetime', classLimit: 3 })
    );
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(updateDoc(doc(db, 'workspaces/ws1'), { name: 'Sekolah A (baru)' }));
    await assertSucceeds(updateDoc(doc(db, 'workspaces/ws1'), { inviteCode: 'ABC123', inviteCodeExpiresAt: 123 }));
  });

  it('denies the owner changing plan/classLimit/seatLimit/planExpiresAt directly (payment-only fields)', async () => {
    await seed((db) =>
      setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'teacherA', name: 'Sekolah A', plan: 'individual_lifetime', classLimit: 3 })
    );
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(updateDoc(doc(db, 'workspaces/ws1'), { plan: 'individual_monthly' }));
    await assertFails(updateDoc(doc(db, 'workspaces/ws1'), { classLimit: 999 }));
    await assertFails(updateDoc(doc(db, 'workspaces/ws1'), { seatLimit: 999 }));
    await assertFails(updateDoc(doc(db, 'workspaces/ws1'), { planExpiresAt: 9999999999999 }));
    // Bahkan kalau dicampur dengan field yang sah, tetap ditolak seluruhnya.
    await assertFails(updateDoc(doc(db, 'workspaces/ws1'), { name: 'Sekolah A (baru)', classLimit: 999 }));
  });

  it('denies get on a workspace that has never opened an invite code (not publicly readable)', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'ownerX', name: 'Sekolah X' }));
    const db = testEnv.authenticatedContext('strangerNoWorkspace').firestore();
    await assertFails(getDoc(doc(db, 'workspaces/ws1')));
  });

  it('lets an authenticated stranger get a single workspace that currently has an invite code open (needed to preview before joining)', async () => {
    await seed((db) =>
      setDoc(doc(db, 'workspaces/ws1'), {
        ownerUid: 'ownerX',
        name: 'Sekolah X',
        inviteCode: 'ABC123',
        inviteCodeExpiresAt: Date.now() + 100000,
      })
    );
    const db = testEnv.authenticatedContext('strangerNoWorkspace').firestore();
    await assertSucceeds(getDoc(doc(db, 'workspaces/ws1')));
  });

  it('never allows listing/querying the workspaces collection at all (no enumeration, even for open-invite workspaces)', async () => {
    await seed((db) =>
      setDoc(doc(db, 'workspaces/ws1'), {
        ownerUid: 'ownerX',
        name: 'Sekolah X',
        inviteCode: 'ABC123',
        inviteCodeExpiresAt: Date.now() + 100000,
      })
    );
    const db = testEnv.authenticatedContext('strangerNoWorkspace').firestore();
    await assertFails(getDocs(query(collection(db, 'workspaces'), where('inviteCode', '==', 'ABC123'))));
  });
});

// ============================================================
// AUDIT T1 — eskalasi hak akses lewat self-write teacher_profiles.
// Ditemukan: role & homeroomClassName tidak dikunci di allow write lama,
// jadi guru TEACHER biasa bisa menulis langsung role:'ADMIN' atau
// homeroomClassName ke kelas mana pun ke profilnya sendiri, lalu lolos
// isAdminOrOwner()/isHomeroomOf() dan membaca student_notes/class_fund/
// class_inventory kelas yang bukan tanggung jawabnya.
// ============================================================
describe('audit T1 — privilege escalation via teacher_profiles self-write', () => {
  it('TEACHER cannot self-promote role to ADMIN via update', async () => {
    await seedProfile('lowUid', 'ws1', 'TEACHER');
    const db = testEnv.authenticatedContext('lowUid').firestore();
    await assertFails(updateDoc(doc(db, 'teacher_profiles/lowUid'), { role: 'ADMIN' }));
  });

  it('TEACHER cannot self-promote role to OWNER via update', async () => {
    await seedProfile('lowUid', 'ws1', 'TEACHER');
    const db = testEnv.authenticatedContext('lowUid').firestore();
    await assertFails(updateDoc(doc(db, 'teacher_profiles/lowUid'), { role: 'OWNER' }));
  });

  it('TEACHER cannot self-assign homeroomClassName to any class', async () => {
    await seedProfile('lowUid', 'ws1', 'TEACHER');
    const db = testEnv.authenticatedContext('lowUid').firestore();
    await assertFails(updateDoc(doc(db, 'teacher_profiles/lowUid'), { homeroomClassName: 'XI-A' }));
  });

  it('TEACHER cannot change workspaceId via update (re-confirms existing lock still holds after T1 rewrite)', async () => {
    await seedProfile('lowUid', 'ws1', 'TEACHER');
    const db = testEnv.authenticatedContext('lowUid').firestore();
    await assertFails(updateDoc(doc(db, 'teacher_profiles/lowUid'), { workspaceId: 'ws2' }));
  });

  it('TEACHER can still update permitted profile fields (name, subject, quickNote) without touching role/workspaceId/homeroomClassName', async () => {
    await seedProfile('lowUid', 'ws1', 'TEACHER');
    const db = testEnv.authenticatedContext('lowUid').firestore();
    await assertSucceeds(updateDoc(doc(db, 'teacher_profiles/lowUid'), { name: 'Budi', subject: 'Matematika' }));
    await assertSucceeds(updateDoc(doc(db, 'teacher_profiles/lowUid'), { quickNote: 'catatan pribadi' }));
  });

  it('OWNER/ADMIN can still self-assign their own homeroomClassName (existing legitimate self-service feature preserved)', async () => {
    await seedProfile('ownerUid', 'ws1', 'OWNER');
    const dbOwner = testEnv.authenticatedContext('ownerUid').firestore();
    await assertSucceeds(updateDoc(doc(dbOwner, 'teacher_profiles/ownerUid'), { homeroomClassName: 'XI-A' }));

    await seedProfile('adminUid', 'ws1', 'ADMIN');
    const dbAdmin = testEnv.authenticatedContext('adminUid').firestore();
    await assertSucceeds(updateDoc(doc(dbAdmin, 'teacher_profiles/adminUid'), { homeroomClassName: 'XI-B' }));
  });

  it('denies self-creating a fresh profile directly with role ADMIN (no product flow produces this, so it is never allowed)', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'someoneElse', name: 'Sekolah A' }));
    const db = testEnv.authenticatedContext('lowUid').firestore();
    await assertFails(setDoc(doc(db, 'teacher_profiles/lowUid'), { workspaceId: 'ws1', role: 'ADMIN' }));
  });

  it('denies self-creating a fresh profile with role OWNER pointing to a workspace owned by someone else', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'realOwner', name: 'Sekolah A' }));
    const db = testEnv.authenticatedContext('impostorUid').firestore();
    await assertFails(setDoc(doc(db, 'teacher_profiles/impostorUid'), { workspaceId: 'ws1', role: 'OWNER' }));
  });

  it('allows self-creating a fresh profile with role OWNER when the workspace really is owned by this uid', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'realOwner', name: 'Sekolah A' }));
    const db = testEnv.authenticatedContext('realOwner').firestore();
    await assertSucceeds(setDoc(doc(db, 'teacher_profiles/realOwner'), { workspaceId: 'ws1', role: 'OWNER' }));
  });

  it('end-to-end: after a denied self-promotion attempt, TEACHER still cannot read another class\'s confidential student_notes (konseling)', async () => {
    await seedProfile('lowUid', 'ws1', 'TEACHER');
    await seed((db) =>
      setDoc(doc(db, 'student_notes/note1'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        category: 'konseling',
        content: 'RAHASIA konseling siswa',
      })
    );
    const db = testEnv.authenticatedContext('lowUid').firestore();

    // Percobaan eskalasi ditolak...
    await assertFails(updateDoc(doc(db, 'teacher_profiles/lowUid'), { role: 'ADMIN', homeroomClassName: 'XI-A' }));
    // ...dan karena itu, akses ke catatan konseling kelas lain tetap tertutup.
    await assertFails(getDoc(doc(db, 'student_notes/note1')));
  });
});

// ============================================================
// AUDIT T2 — join workspace lewat kode undangan.
// Ditemukan: findWorkspaceByInviteCode() query where(inviteCode==...)
// langsung ke collection workspaces, padahal allow read di sana mustahil
// dipenuhi guru baru (bukan owner, belum py workspaceId). Diperbaiki
// lewat collection jembatan workspace_invites/{code} (get by ID, bukan
// query) + allow get bersyarat di workspaces + pengecekan kedaluwarsa
// sungguhan di titik teacher_profiles.allow create.
// ============================================================
describe('audit T2 — join workspace via invite code', () => {
  it('a brand new teacher (no workspace yet) can get the invite bridge doc by code', async () => {
    await seed((db) => setDoc(doc(db, 'workspace_invites/ABC123'), { workspaceId: 'ws1', expiresAt: Date.now() + 100000 }));
    const db = testEnv.authenticatedContext('newTeacher').firestore();
    await assertSucceeds(getDoc(doc(db, 'workspace_invites/ABC123')));
  });

  it('workspace_invites is never listable (no enumerating all active invite codes)', async () => {
    await seed((db) => setDoc(doc(db, 'workspace_invites/ABC123'), { workspaceId: 'ws1', expiresAt: Date.now() + 100000 }));
    const db = testEnv.authenticatedContext('newTeacher').firestore();
    await assertFails(getDocs(collection(db, 'workspace_invites')));
  });

  it('only the real workspace owner can create the invite bridge doc (cannot forge one pointing at someone else\'s workspace)', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'realOwner', name: 'Sekolah A' }));
    const impostor = testEnv.authenticatedContext('impostorUid').firestore();
    await assertFails(setDoc(doc(impostor, 'workspace_invites/FAKE01'), { workspaceId: 'ws1', expiresAt: Date.now() + 100000 }));

    const owner = testEnv.authenticatedContext('realOwner').firestore();
    await assertSucceeds(setDoc(doc(owner, 'workspace_invites/REAL01'), { workspaceId: 'ws1', expiresAt: Date.now() + 100000 }));
  });

  it('full join: new teacher can join a real workspace with a valid, unexpired invite code', async () => {
    await seed((db) =>
      setDoc(doc(db, 'workspaces/ws1'), {
        ownerUid: 'ownerX',
        name: 'Sekolah X',
        inviteCode: 'ABC123',
        inviteCodeExpiresAt: Date.now() + 100000,
      })
    );
    await seed((db) => setDoc(doc(db, 'workspace_invites/ABC123'), { workspaceId: 'ws1', expiresAt: Date.now() + 100000 }));
    await seedProfile('newTeacher', null, 'TEACHER'); // profil awal kosong, workspaceId belum ada

    const db = testEnv.authenticatedContext('newTeacher').firestore();
    // Langkah 1: temukan workspace lewat jembatan kode.
    const bridge = await getDoc(doc(db, 'workspace_invites/ABC123'));
    expect(bridge.exists()).toBe(true);
    await assertSucceeds(getDoc(doc(db, 'workspaces/ws1')));
    // Langkah 2: gabung sungguhan.
    await assertSucceeds(updateDoc(doc(db, 'teacher_profiles/newTeacher'), { workspaceId: 'ws1', role: 'TEACHER' }));
  });

  it('denies joining with an EXPIRED invite code, even if the bridge doc still exists', async () => {
    await seed((db) =>
      setDoc(doc(db, 'workspaces/ws1'), {
        ownerUid: 'ownerX',
        name: 'Sekolah X',
        inviteCode: 'OLD999',
        inviteCodeExpiresAt: Date.now() - 100000, // sudah lewat
      })
    );
    await seed((db) => setDoc(doc(db, 'workspace_invites/OLD999'), { workspaceId: 'ws1', expiresAt: Date.now() - 100000 }));
    await seedProfile('newTeacher', null, 'TEACHER');

    const db = testEnv.authenticatedContext('newTeacher').firestore();
    await assertFails(updateDoc(doc(db, 'teacher_profiles/newTeacher'), { workspaceId: 'ws1', role: 'TEACHER' }));
  });

  it('denies joining (self-creating profile) a workspace that never opened an invite code, even if the workspaceId is known (no ID-guessing bypass)', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'ownerX', name: 'Sekolah X', plan: 'individual_lifetime' }));
    const db = testEnv.authenticatedContext('guessingUid').firestore();
    await assertFails(setDoc(doc(db, 'teacher_profiles/guessingUid'), { workspaceId: 'ws1', role: 'TEACHER' }));
  });

  it('denies an invalid/unknown invite code from resolving to anything', async () => {
    const db = testEnv.authenticatedContext('newTeacher').firestore();
    const bridge = await getDoc(doc(db, 'workspace_invites/DOESNOTEXIST'));
    expect(bridge.exists()).toBe(false);
  });

  it('a teacher already in another workspace cannot use this mechanism to bypass tenancy isolation (workspaceId already locked)', async () => {
    await seed((db) =>
      setDoc(doc(db, 'workspaces/ws2'), {
        ownerUid: 'ownerY',
        name: 'Sekolah Y',
        inviteCode: 'JOIN22',
        inviteCodeExpiresAt: Date.now() + 100000,
      })
    );
    await seedProfile('existingTeacher', 'ws1', 'TEACHER'); // sudah tergabung workspace lain
    const db = testEnv.authenticatedContext('existingTeacher').firestore();
    await assertFails(updateDoc(doc(db, 'teacher_profiles/existingTeacher'), { workspaceId: 'ws2', role: 'TEACHER' }));
  });
});

describe('payments', () => {
  it('lets the workspace owner read their own payment history', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'teacherA', name: 'Sekolah A' }));
    await seed((db) => setDoc(doc(db, 'payments/order1'), { workspaceId: 'ws1', plan: 'individual_onetime', status: 'settled' }));
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(getDoc(doc(db, 'payments/order1')));
  });

  it('denies a non-owner from reading payment history', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'teacherA', name: 'Sekolah A' }));
    await seed((db) => setDoc(doc(db, 'payments/order1'), { workspaceId: 'ws1', plan: 'individual_onetime', status: 'settled' }));
    const db = testEnv.authenticatedContext('teacherB').firestore();
    await assertFails(getDoc(doc(db, 'payments/order1')));
  });

  it('denies any client write, even from the workspace owner', async () => {
    await seed((db) => setDoc(doc(db, 'workspaces/ws1'), { ownerUid: 'teacherA', name: 'Sekolah A' }));
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(
      setDoc(doc(db, 'payments/order1'), { workspaceId: 'ws1', plan: 'individual_onetime', status: 'settled' })
    );
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
  'announcements',
  'session_skip_reasons',
  'academic_years',
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

// Rules dievaluasi berbeda untuk `get` (satu dokumen) dan `list` (query):
// pada list, Firestore menolak kalau filter query tidak MENJAMIN semua
// dokumen hasilnya lolos rule. Halaman-halaman Student Companion semuanya
// pakai query, jadi bagian ini menguji query persis seperti yang dipakai
// repository — sekali filternya salah, halamannya blank walau rule get-nya
// benar.
describe('Student Companion — query (list) harus lolos rules, bukan cuma get', () => {
  it('lets a student list schedules filtered by workspaceId + className', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) => setDoc(doc(db, 'schedules/sc1'), { workspaceId: 'ws1', className: 'XI-A', day: 'Senin' }));
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'schedules'), where('workspaceId', '==', 'ws1'), where('className', '==', 'XI-A')))
    );
  });

  it('denies a student listing schedules by workspaceId alone (would leak other classes)', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDocs(query(collection(db, 'schedules'), where('workspaceId', '==', 'ws1'))));
  });

  it('lets a student list announcements for their own class', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'announcements/an1'), { workspaceId: 'ws1', className: 'XI-A', title: 'Ulangan Senin' })
    );
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'announcements'), where('workspaceId', '==', 'ws1'), where('className', '==', 'XI-A')))
    );
  });

  it('denies a student reading an announcement meant for another class', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'announcements/an1'), { workspaceId: 'ws1', className: 'XI-B', title: 'Ulangan Senin' })
    );
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDoc(doc(db, 'announcements/an1')));
  });

  it('denies a student writing an announcement (teacher-only)', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      setDoc(doc(db, 'announcements/an1'), { workspaceId: 'ws1', className: 'XI-A', title: 'Libur' })
    );
  });

  it('lets a student list assignments filtered by workspaceId + className', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'assignments'), where('workspaceId', '==', 'ws1'), where('className', '==', 'XI-A')))
    );
  });

  it('lets a student list grade_columns filtered by workspaceId + className', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'grade_columns'), where('workspaceId', '==', 'ws1'), where('className', '==', 'XI-A')))
    );
  });

  it('lets a student list attendances filtered by workspaceId + className', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'attendances'), where('workspaceId', '==', 'ws1'), where('className', '==', 'XI-A')))
    );
  });

  it('lets a student list their own grades filtered by workspaceId + studentId', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) => setDoc(doc(db, 'grades/g1'), { workspaceId: 'ws1', studentId: 's1', score: '90' }));
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'grades'), where('workspaceId', '==', 'ws1'), where('studentId', '==', 's1')))
    );
  });

  it('denies a student listing grades by className (would expose the whole class)', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      getDocs(query(collection(db, 'grades'), where('workspaceId', '==', 'ws1'), where('className', '==', 'XI-A')))
    );
  });

  it('denies a student listing grades belonging to another student', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      getDocs(query(collection(db, 'grades'), where('workspaceId', '==', 'ws1'), where('studentId', '==', 's2')))
    );
  });

  it('lets a student list their own submissions filtered by workspaceId + studentId', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'submissions'), where('workspaceId', '==', 'ws1'), where('studentId', '==', 's1')))
    );
  });

  it('denies a student listing every submission for an assignment (classmates\' answers)', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      getDocs(query(collection(db, 'submissions'), where('workspaceId', '==', 'ws1'), where('assignmentId', '==', 'a1')))
    );
  });

  it('still lets a teacher list submissions for an assignment (grading view)', async () => {
    await seedProfile('teacherA', 'ws1');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'submissions'), where('workspaceId', '==', 'ws1'), where('assignmentId', '==', 'a1')))
    );
  });
});

// Alur klaim kode akses (studentAuthService.claimAccessCode) berjalan
// sebagai siswa yang BELUM punya student_profiles. Test ini memastikan
// setiap baca yang dilakukan alur itu memang diizinkan rules — kalau ada
// satu saja yang ditolak, siswa tidak akan pernah bisa masuk.
describe('alur klaim kode akses — semua baca yang dibutuhkan harus lolos', () => {
  it('lets a not-yet-claimed user read the login code document', async () => {
    await seed((db) =>
      setDoc(doc(db, 'student_login_codes/ABC123'), { studentId: 's1', workspaceId: 'ws1' })
    );
    const db = testEnv.authenticatedContext('freshAnon').firestore();
    await assertSucceeds(getDoc(doc(db, 'student_login_codes/ABC123')));
  });

  // Justru karena baca ini SELALU ditolak, dokumen kode akses harus
  // memuat sendiri identitas siswa — bukan sekadar studentId. Test ini
  // mengunci alasan itu supaya tidak ada yang "menyederhanakan" kembali
  // ke pola baca students dan diam-diam mematikan login siswa.
  it('CANNOT read the students document during claim (no teacher profile, no student profile yet)', async () => {
    await seed((db) =>
      setDoc(doc(db, 'students/s1'), { workspaceId: 'ws1', className: 'XI-A', name: 'Budi', nis: '123' })
    );
    const db = testEnv.authenticatedContext('freshAnon').firestore();
    await assertFails(getDoc(doc(db, 'students/s1')));
  });

  it('completes the whole claim flow using only the login code document', async () => {
    await seed((db) =>
      setDoc(doc(db, 'student_login_codes/ABC123'), {
        studentId: 's1',
        workspaceId: 'ws1',
        name: 'Budi',
        className: 'XI-A',
        nis: '123',
      })
    );
    const db = testEnv.authenticatedContext('freshAnon').firestore();

    const codeSnap = await getDoc(doc(db, 'student_login_codes/ABC123'));
    const code = codeSnap.data()!;
    expect(code.className).toBe('XI-A');
    expect(code.name).toBe('Budi');

    await assertSucceeds(
      setDoc(doc(db, 'student_profiles/freshAnon'), {
        studentId: code.studentId,
        workspaceId: code.workspaceId,
        className: code.className,
        name: code.name,
        nis: code.nis,
      })
    );

    // Dan setelah klaim, data akademiknya langsung terbaca.
    await seed((d) => setDoc(doc(d, 'schedules/sc1'), { workspaceId: 'ws1', className: 'XI-A' }));
    await assertSucceeds(getDoc(doc(db, 'schedules/sc1')));
  });
});

describe('student_achievements — prestasi boleh dilihat siswa, konseling tidak ikut terbuka', () => {
  it('lets a student read their own achievement', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'student_achievements/a1'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        studentId: 's1',
        title: 'Juara 1 Debat',
      })
    );
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(getDoc(doc(db, 'student_achievements/a1')));
  });

  it('lets a student list their own achievements', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'student_achievements'),
          where('workspaceId', '==', 'ws1'),
          where('studentId', '==', 's1')
        )
      )
    );
  });

  it('denies a student reading a classmate\'s achievement', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'student_achievements/a2'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        studentId: 's2',
        title: 'Juara 2 Sains',
      })
    );
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDoc(doc(db, 'student_achievements/a2')));
  });

  it('denies a student listing achievements of the whole class', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      getDocs(
        query(
          collection(db, 'student_achievements'),
          where('workspaceId', '==', 'ws1'),
          where('className', '==', 'XI-A')
        )
      )
    );
  });

  it('denies a student recording an achievement for themselves', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      setDoc(doc(db, 'student_achievements/a3'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        studentId: 's1',
        title: 'Juara 1 (mengaku sendiri)',
      })
    );
  });

  it('denies a student from another workspace reading an achievement', async () => {
    await seedStudentProfile('studentUidX', 's1', 'ws2', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'student_achievements/a1'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        studentId: 's1',
        title: 'Juara 1 Debat',
      })
    );
    const db = testEnv.authenticatedContext('studentUidX').firestore();
    await assertFails(getDoc(doc(db, 'student_achievements/a1')));
  });

  it('lets the homeroom teacher create and read achievements', async () => {
    await seedProfile('teacherA', 'ws1', 'TEACHER', 'XI-A');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'student_achievements/a1'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        studentId: 's1',
        title: 'Juara 1 Debat',
      })
    );
    await assertSucceeds(getDoc(doc(db, 'student_achievements/a1')));
  });

  it('denies a non-homeroom teacher creating an achievement', async () => {
    await seedProfile('teacherB', 'ws1', 'TEACHER', 'XI-B');
    const db = testEnv.authenticatedContext('teacherB').firestore();
    await assertFails(
      setDoc(doc(db, 'student_achievements/a1'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        studentId: 's1',
        title: 'Juara 1 Debat',
      })
    );
  });

  // ==== INVARIANT UTAMA: konseling tetap tertutup rapat untuk siswa ====

  it('STILL denies a student reading their OWN counselling note', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'student_notes/n1'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        category: 'konseling',
        studentId: 's1',
        title: 'rahasia',
      })
    );
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDoc(doc(db, 'student_notes/n1')));
  });

  it('STILL denies a student reading a legacy prestasi note left in student_notes', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'student_notes/n2'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        category: 'prestasi',
        studentId: 's1',
        title: 'Juara 1 lama',
      })
    );
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDoc(doc(db, 'student_notes/n2')));
  });

  it('STILL denies a student listing student_notes by any filter combination', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(
      getDocs(query(collection(db, 'student_notes'), where('workspaceId', '==', 'ws1')))
    );
    await assertFails(
      getDocs(
        query(
          collection(db, 'student_notes'),
          where('workspaceId', '==', 'ws1'),
          where('studentId', '==', 's1')
        )
      )
    );
    await assertFails(
      getDocs(
        query(
          collection(db, 'student_notes'),
          where('workspaceId', '==', 'ws1'),
          where('studentId', '==', 's1'),
          where('category', '==', 'prestasi')
        )
      )
    );
    await assertFails(
      getDocs(
        query(
          collection(db, 'student_notes'),
          where('workspaceId', '==', 'ws1'),
          where('studentId', '==', 's1'),
          where('category', '==', 'konseling')
        )
      )
    );
  });
});

// Regresi untuk lubang yang ditemukan test prestasi: isOwnStudentData
// dulu hanya mencocokkan studentId tanpa workspaceId, sehingga siswa di
// workspace lain dengan studentId yang sama bisa membaca data ini.
describe('isolasi antar-workspace untuk data milik siswa', () => {
  it('denies a student in another workspace reading grades with the same studentId', async () => {
    await seedStudentProfile('studentUidX', 's1', 'ws2', 'XI-A');
    await seed((db) => setDoc(doc(db, 'grades/g1'), { workspaceId: 'ws1', studentId: 's1', score: '90' }));
    const db = testEnv.authenticatedContext('studentUidX').firestore();
    await assertFails(getDoc(doc(db, 'grades/g1')));
  });

  it('denies a student in another workspace reading submissions with the same studentId', async () => {
    await seedStudentProfile('studentUidX', 's1', 'ws2', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'submissions/a1_s1'), {
        workspaceId: 'ws1',
        assignmentId: 'a1',
        studentId: 's1',
        status: 'menunggu_penilaian',
      })
    );
    const db = testEnv.authenticatedContext('studentUidX').firestore();
    await assertFails(getDoc(doc(db, 'submissions/a1_s1')));
  });

  it('denies a student creating a submission into another workspace', async () => {
    await seedStudentProfile('studentUidX', 's1', 'ws2', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidX').firestore();
    await assertFails(
      setDoc(doc(db, 'submissions/a1_s1'), {
        workspaceId: 'ws1',
        assignmentId: 'a1',
        studentId: 's1',
        status: 'menunggu_penilaian',
      })
    );
  });

  it('still lets a student in the right workspace read and submit as before', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    await seed((db) => setDoc(doc(db, 'grades/g1'), { workspaceId: 'ws1', studentId: 's1', score: '90' }));
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertSucceeds(getDoc(doc(db, 'grades/g1')));
    await assertSucceeds(
      setDoc(doc(db, 'submissions/a1_s1'), {
        workspaceId: 'ws1',
        assignmentId: 'a1',
        studentId: 's1',
        status: 'menunggu_penilaian',
        textAnswer: 'jawaban',
      })
    );
  });
});

// Halaman Prestasi guru memuat daftar lewat query, bukan get satu dokumen.
// Dibedakan eksplisit karena rules list dievaluasi berbeda — inilah jenis
// celah yang dulu membuat alur login siswa lolos test tapi mati di produksi.
describe('student_achievements — query (list) dari sisi guru', () => {
  it('lets the homeroom teacher list achievements of their own class', async () => {
    await seedProfile('teacherA', 'ws1', 'TEACHER', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'student_achievements/a1'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        studentId: 's1',
        title: 'Juara 1 Debat',
      })
    );
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'student_achievements'),
          where('workspaceId', '==', 'ws1'),
          where('className', '==', 'XI-A')
        )
      )
    );
  });

  it('denies a teacher listing achievements of a class they do not homeroom', async () => {
    await seedProfile('teacherB', 'ws1', 'TEACHER', 'XI-B');
    const db = testEnv.authenticatedContext('teacherB').firestore();
    await assertFails(
      getDocs(
        query(
          collection(db, 'student_achievements'),
          where('workspaceId', '==', 'ws1'),
          where('className', '==', 'XI-A')
        )
      )
    );
  });

  it('lets an OWNER list achievements even without being homeroom', async () => {
    await seedProfile('owner1', 'ws1', 'OWNER');
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'student_achievements'),
          where('workspaceId', '==', 'ws1'),
          where('className', '==', 'XI-A')
        )
      )
    );
  });

  it('lets the homeroom teacher delete an achievement', async () => {
    await seedProfile('teacherA', 'ws1', 'TEACHER', 'XI-A');
    await seed((db) =>
      setDoc(doc(db, 'student_achievements/a1'), {
        workspaceId: 'ws1',
        className: 'XI-A',
        studentId: 's1',
        title: 'Juara 1 Debat',
      })
    );
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(deleteDoc(doc(db, 'student_achievements/a1')));
  });
});

// Halaman Analitik memuat assignments & submissions se-workspace sekaligus
// (satu query, bukan per kelas). Query list punya aturan evaluasi sendiri,
// jadi bentuk persis yang dipakai analyticsRepository diuji di sini.
describe('Analitik — query se-workspace dari sisi guru', () => {
  it('lets a teacher list all assignments in their workspace', async () => {
    await seedProfile('teacherA', 'ws1');
    await seed((db) => setDoc(doc(db, 'assignments/a1'), { workspaceId: 'ws1', className: 'XI-A' }));
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(getDocs(query(collection(db, 'assignments'), where('workspaceId', '==', 'ws1'))));
  });

  it('lets a teacher list all submissions in their workspace', async () => {
    await seedProfile('teacherA', 'ws1');
    await seed((db) =>
      setDoc(doc(db, 'submissions/s1'), { workspaceId: 'ws1', assignmentId: 'a1', studentId: 'st1' })
    );
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertSucceeds(getDocs(query(collection(db, 'submissions'), where('workspaceId', '==', 'ws1'))));
  });

  it('denies listing assignments of another workspace', async () => {
    await seedProfile('teacherA', 'ws1');
    const db = testEnv.authenticatedContext('teacherA').firestore();
    await assertFails(getDocs(query(collection(db, 'assignments'), where('workspaceId', '==', 'ws2'))));
  });

  it('denies a student listing every submission in the workspace', async () => {
    await seedStudentProfile('studentUidA', 's1', 'ws1', 'XI-A');
    const db = testEnv.authenticatedContext('studentUidA').firestore();
    await assertFails(getDocs(query(collection(db, 'submissions'), where('workspaceId', '==', 'ws1'))));
  });
});
