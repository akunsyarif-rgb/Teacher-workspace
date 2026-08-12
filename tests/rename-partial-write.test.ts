import { describe, expect, it, vi } from 'vitest';
import { renameClassServer } from '../lib/server/classAdminService';

// Firestore membatasi 500 operasi per batch, jadi rename kelas besar terpaksa
// dipecah — dan pecahan itu TIDAK atomik satu sama lain. Kalau sebuah batch
// gagal setelah batch sebelumnya sukses, sebagian dokumen sudah memakai nama
// baru sementara sisanya belum.
//
// Yang diuji di sini: kondisi itu tidak boleh dilaporkan sebagai sukses, dan
// pesannya harus menyebut berapa dokumen yang terlanjur berubah supaya guru
// tahu harus memeriksa konsistensi — bukan sekadar mengulang, karena mengulang
// di atas rename separuh jadi memperburuk keadaan.
//
// Skenario ini mustahil dipicu lewat emulator, jadi Admin SDK disuntik palsu.

const WORKSPACE = 'ws-1';
const UID = 'guru-1';

type FakeOptions = {
  jumlahDokumen: number;
  gagalPadaBatchKe?: number; // 1-based; undefined = semua batch sukses
};

function buatFakeDb({ jumlahDokumen, gagalPadaBatchKe }: FakeOptions) {
  const commits: number[] = [];
  const updated: string[] = [];
  let batchKe = 0;

  // Dokumen dibagi rata ke koleksi pertama saja; koleksi lain dibuat kosong
  // supaya jumlah totalnya mudah dikendalikan.
  const docsFor = (collectionName: string) =>
    collectionName === 'students'
      ? Array.from({ length: jumlahDokumen }, (_, i) => ({ ref: { id: `doc-${i}` } }))
      : [];

  const db = {
    collection(name: string) {
      return {
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({ workspaceId: WORKSPACE }),
          }),
        }),
        where() {
          return {
            where() {
              return this;
            },
            limit() {
              return this;
            },
            // Query tabrakan nama: harus kosong supaya rename lanjut.
            get: async () => ({ empty: true, docs: docsFor(name) }),
          };
        },
      };
    },
    batch() {
      batchKe += 1;
      const iniBatchKe = batchKe;
      const refs: string[] = [];
      return {
        update(ref: { id: string }) {
          refs.push(ref.id);
        },
        async commit() {
          if (gagalPadaBatchKe && iniBatchKe === gagalPadaBatchKe) {
            throw new Error('DEADLINE_EXCEEDED');
          }
          commits.push(refs.length);
          updated.push(...refs);
        },
      };
    },
  };

  return { db: db as any, commits, updated };
}

describe('kegagalan antar-batch tidak pernah dilaporkan sebagai sukses', () => {
  it('batch kedua gagal -> melempar, bukan mengembalikan hasil sukses', async () => {
    // 700 dokumen = 2 batch (500 + 200). Batch ke-2 sengaja digagalkan.
    const { db, commits } = buatFakeDb({ jumlahDokumen: 700, gagalPadaBatchKe: 2 });

    await expect(renameClassServer(UID, 'X-1', 'X-2', db)).rejects.toThrow();

    // Batch pertama memang sudah ter-commit — itulah kondisi partial write.
    expect(commits).toEqual([500]);
  });

  it('pesannya menyebut jumlah yang terlanjur berubah dan kedua nama kelas', async () => {
    const { db } = buatFakeDb({ jumlahDokumen: 700, gagalPadaBatchKe: 2 });

    await expect(renameClassServer(UID, 'X-1', 'X-2', db)).rejects.toThrow(
      /500 dari 700 dokumen sudah memakai nama "X-2"[\s\S]*sisanya masih "X-1"/
    );
  });

  it('pesannya menyuruh memeriksa konsistensi, bukan langsung mengulang', async () => {
    const { db } = buatFakeDb({ jumlahDokumen: 700, gagalPadaBatchKe: 2 });

    await expect(renameClassServer(UID, 'X-1', 'X-2', db)).rejects.toThrow(/[Pp]eriksa konsistensi/);
  });

  it('batch pertama gagal -> nol dokumen berubah, dilaporkan apa adanya', async () => {
    const { db, commits } = buatFakeDb({ jumlahDokumen: 700, gagalPadaBatchKe: 1 });

    await expect(renameClassServer(UID, 'X-1', 'X-2', db)).rejects.toThrow(/0 dari 700/);
    expect(commits).toEqual([]);
  });

  it('penyebab asli dari Firestore ikut disertakan', async () => {
    const { db } = buatFakeDb({ jumlahDokumen: 700, gagalPadaBatchKe: 2 });

    await expect(renameClassServer(UID, 'X-1', 'X-2', db)).rejects.toThrow(/DEADLINE_EXCEEDED/);
  });
});

describe('jalur sukses tetap utuh', () => {
  it('semua batch sukses -> mengembalikan jumlah dokumen & nama baru', async () => {
    const { db, commits } = buatFakeDb({ jumlahDokumen: 700 });

    const hasil = await renameClassServer(UID, 'X-1', 'X-2', db);

    expect(hasil).toEqual({ renamedCount: 700, className: 'X-2' });
    expect(commits).toEqual([500, 200]);
  });

  it('nama baru dinormalisasi & divalidasi di server, bukan cuma di client', async () => {
    const { db } = buatFakeDb({ jumlahDokumen: 10 });

    const hasil = await renameClassServer(UID, 'X-1', '  XI  A   KESEHATAN 1  ', db);
    expect(hasil.className).toBe('XI A KESEHATAN 1');
  });

  it('nama kosong ditolak sebelum menyentuh batch apa pun', async () => {
    const { db, commits } = buatFakeDb({ jumlahDokumen: 10 });

    await expect(renameClassServer(UID, 'X-1', '   ', db)).rejects.toThrow(/wajib diisi/i);
    expect(commits).toEqual([]);
  });

  it('nama lebih dari 100 karakter ditolak', async () => {
    const { db, commits } = buatFakeDb({ jumlahDokumen: 10 });

    await expect(renameClassServer(UID, 'X-1', 'A'.repeat(101), db)).rejects.toThrow(/100 karakter/);
    expect(commits).toEqual([]);
  });
});
