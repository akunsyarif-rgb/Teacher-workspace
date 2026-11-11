'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal';
import RecycleBinView, { type Filter } from './RecycleBinView';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as recycleBinController from '@/lib/controllers/recycleBinController';
import type { BinItem, RecycleBinData } from '@/lib/controllers/recycleBinController';

export default function RecycleBinPanel() {
  const { workspaceId, role, user } = useWorkspace();
  const uid = user?.uid ?? '';
  const [data, setData] = useState<RecycleBinData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [purgeTarget, setPurgeTarget] = useState<BinItem | null>(null);
  const [emptying, setEmptying] = useState(false);

  const viewer = useMemo(() => ({ uid, role: role ?? null }), [uid, role]);
  const canPurge = recycleBinController.canPurge(viewer);

  // Muat awal / saat peran berganti. State hanya diubah SETELAH data tiba (bukan sinkron di dalam
  // efek), dan dibatalkan bila komponen sudah tidak dipakai.
  useEffect(() => {
    if (!workspaceId || !uid) return;
    let cancelled = false;
    recycleBinController
      .fetchRecycleBin(workspaceId, viewer)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError('');
      })
      .catch((e) => {
        console.error('Gagal memuat Sampah:', e);
        if (!cancelled) setError('Gagal memuat Sampah. Periksa koneksi lalu coba lagi.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, uid, viewer]);

  // Muat ulang daftar setelah pemulihan/penghapusan (tanpa kembali ke layar "memuat").
  const refresh = useCallback(async () => {
    if (!workspaceId || !uid) return;
    setData(await recycleBinController.fetchRecycleBin(workspaceId, viewer));
  }, [workspaceId, uid, viewer]);

  async function handleRestore(item: BinItem) {
    setBusyKey(item.key);
    setError('');
    setNotice('');
    try {
      await recycleBinController.restoreItem(item, viewer);
      setNotice(`${item.title} dipulihkan.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memulihkan. Coba lagi.');
    } finally {
      setBusyKey(null);
    }
  }

  // Dipanggil ConfirmDeleteModal. Bila melempar, modal tetap terbuka... karena itu galat ditampilkan
  // di halaman dan modal ditutup lewat state sebelum melempar ulang (pola yang sama dengan ClassDetail).
  async function confirmPurge() {
    const item = purgeTarget;
    if (!item) return;
    setError('');
    setNotice('');
    try {
      await recycleBinController.purgeItem(item, viewer);
      setNotice(`${item.title} dihapus permanen.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus permanen. Coba lagi.');
      setPurgeTarget(null);
      throw e;
    }
  }

  async function confirmEmpty() {
    setError('');
    setNotice('');
    try {
      const { counts } = await recycleBinController.emptyBin(viewer);
      setNotice(`Sampah dikosongkan (${counts.students} siswa, ${counts.assignments} tugas, ${counts.columns} kolom nilai dihapus permanen).`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengosongkan Sampah. Coba lagi.');
      setEmptying(false);
      await refresh().catch(() => {}); // sebagian mungkin sudah terhapus
      throw e;
    }
  }

  const items: BinItem[] = useMemo(() => {
    if (!data) return [];
    const all = [...data.classes, ...data.students, ...data.assignments, ...data.columns];
    const chosen = filter === 'all' ? all : all.filter((i) => i.kind === filter);
    return filter === 'all' ? chosen.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)) : chosen;
  }, [data, filter]);

  const counts: Record<Filter, number> = {
    all: data?.total ?? 0,
    class: data?.classes.length ?? 0,
    student: data?.students.length ?? 0,
    assignment: data?.assignments.length ?? 0,
    column: data?.columns.length ?? 0,
  };

  return (
    <>
      <RecycleBinView
        items={items}
        counts={counts}
        filter={filter}
        loading={loading && !data}
        uid={uid}
        busyKey={busyKey}
        canPurge={canPurge}
        notice={notice}
        error={error}
        onFilter={setFilter}
        onDismissError={() => setError('')}
        onRestore={handleRestore}
        onPurge={(item) => setPurgeTarget(item)}
        onEmpty={() => setEmptying(true)}
      />

      {canPurge && (
        <>
          <ConfirmDeleteModal
            isOpen={!!purgeTarget}
            onClose={() => setPurgeTarget(null)}
            onConfirm={confirmPurge}
            title="Hapus Permanen?"
            itemName={purgeTarget?.title ?? ''}
            itemDetail={purgeTarget ? recycleBinController.describePurgeScope(purgeTarget) : undefined}
            requireTyping
            type="danger"
          />
          <ConfirmDeleteModal
            isOpen={emptying}
            onClose={() => setEmptying(false)}
            onConfirm={confirmEmpty}
            title="Kosongkan Sampah?"
            itemName={`Seluruh isi Sampah (${counts.all} item)`}
            itemDetail="Semua kelas, siswa, tugas, dan kolom nilai di Sampah beserta data turunannya (nilai, pengumpulan tugas dan lampiran, prestasi, catatan, kode akses) dihapus SELAMANYA."
            requireTyping
            type="danger"
          />
        </>
      )}
    </>
  );
}
