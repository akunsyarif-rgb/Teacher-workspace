import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

// Kepemilikan lampiran dibuktikan dari UID di path (lihat storage.rules),
// jadi seluruh aturan bisa diuji tanpa bergantung pada cross-service
// rules yang tidak berfungsi di emulator.
let testEnv: RulesTestEnvironment;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const META = { contentType: 'image/png' };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-teacher-workspace',
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: 'localhost',
      port: 9199,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearStorage();
});

const path = (userId: string, workspaceId = 'ws1', assignmentId = 'a1') =>
  `submissions/${workspaceId}/${assignmentId}/${userId}/jawaban.png`;

describe('storage.rules — lampiran tugas', () => {
  it('lets a student upload into their own folder', async () => {
    const storage = testEnv.authenticatedContext('studentUidA').storage();
    await assertSucceeds(uploadBytes(ref(storage, path('studentUidA')), PNG, META));
  });

  it('denies uploading into someone else\'s folder', async () => {
    const storage = testEnv.authenticatedContext('studentUidA').storage();
    await assertFails(uploadBytes(ref(storage, path('studentUidB')), PNG, META));
  });

  it('denies unauthenticated uploads', async () => {
    const storage = testEnv.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(storage, path('studentUidA')), PNG, META));
  });

  it('denies a disallowed content type (e.g. video)', async () => {
    const storage = testEnv.authenticatedContext('studentUidA').storage();
    await assertFails(
      uploadBytes(ref(storage, path('studentUidA')), PNG, { contentType: 'video/mp4' })
    );
  });

  it('denies a file over the 10MB limit', async () => {
    const storage = testEnv.authenticatedContext('studentUidA').storage();
    const tooBig = new Uint8Array(10 * 1024 * 1024 + 1);
    await assertFails(uploadBytes(ref(storage, path('studentUidA')), tooBig, META));
  });

  it('accepts a PDF (common for scanned homework)', async () => {
    const storage = testEnv.authenticatedContext('studentUidA').storage();
    await assertSucceeds(
      uploadBytes(ref(storage, `submissions/ws1/a1/studentUidA/jawaban.pdf`), PNG, {
        contentType: 'application/pdf',
      })
    );
  });

  it('lets the uploader read their own file back', async () => {
    const storage = testEnv.authenticatedContext('studentUidA').storage();
    await uploadBytes(ref(storage, path('studentUidA')), PNG, META);
    await assertSucceeds(getBytes(ref(storage, path('studentUidA'))));
  });

  it('denies reading a classmate\'s file through the rules path', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path('studentUidB')), PNG, META);
    });
    const storage = testEnv.authenticatedContext('studentUidA').storage();
    await assertFails(getBytes(ref(storage, path('studentUidB'))));
  });

  it('never allows deleting a submitted file', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path('studentUidA')), PNG, META);
    });
    const storage = testEnv.authenticatedContext('studentUidA').storage();
    const { deleteObject } = await import('firebase/storage');
    await assertFails(deleteObject(ref(storage, path('studentUidA'))));
  });

  it('denies writing anywhere outside the submissions path', async () => {
    const storage = testEnv.authenticatedContext('studentUidA').storage();
    await assertFails(uploadBytes(ref(storage, 'random/file.png'), PNG, META));
  });
});
