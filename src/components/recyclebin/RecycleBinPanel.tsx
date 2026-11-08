'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Users, GraduationCap, ClipboardList, Table2, Trash2, CheckCircle2 } from 'lucide-react';
import Card from '../ui/Card';
import InlineAlert from '../ui/InlineAlert';
import LoadingSpinner from '../ui/LoadingSpinner';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as recycleBinController from '@/lib/controllers/recycleBinController';
import type { BinItem, BinKind, RecycleBinData } from '@/lib/controllers/recycleBinController';

type Filter = 'all' | BinKind;

const KIND_META: Record<BinKind, { label: string; plural: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  class: { label: 'Kelas', plural: 'Kelas', icon: GraduationCap, tone: 'bg-emerald-600' },
  student: { label: 'Siswa', plural: 'Siswa', icon: Users, tone: 'bg-nb-green' },
  assignment: { label: 'Tugas', plural: 'Tugas', icon: ClipboardList, tone: 'bg-amber-600' },
  column: { label: 'Kolom nilai', plural: 'Kolom nilai', icon: Table2, tone: 'bg-sky-700' },
};

const FILTER_ORDER: Filter[] = ['all', 'class', 'student', 'assignment', 'column'];

function formatDeleted(ms: number | null): string {
  if (ms === null) return 'Tanggal tidak diketahui';
  return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RecycleBinPanel() {
  const { workspaceId, role, user } = useWorkspace();
  const uid = user?.uid ?? '';
  const [data, setData] = useState<RecycleBinData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const viewer = useMemo(() => ({ uid, role: role ?? null }), [uid, role]);

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

  // Muat ulang daftar setelah pemulihan (tanpa kembali ke layar "memuat").
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
    <div className="space-y-4">
      <Card className="space-y-1">
        <p className="text-xs text-nb-ink-muted">
          Siswa, tugas, kolom nilai, dan kelas yang Anda hapus disimpan di sini dan bisa dipulihkan beserta isinya.
          Guru biasa hanya melihat item yang ia buat sendiri; pemilik dan admin melihat semuanya.
        </p>
      </Card>

      <div role="status" aria-live="polite" className="space-y-2">
        {notice && (
          <div className="p-3.5 bg-[#EDF3E8] border border-[#D9DED5] rounded-2xl text-xs font-bold text-[#24563F] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="flex-1">{notice}</span>
          </div>
        )}
      </div>
      <InlineAlert message={error} onDismiss={() => setError('')} />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Saring jenis item">
        {FILTER_ORDER.map((f) => {
          const label = f === 'all' ? 'Semua' : KIND_META[f].plural;
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f)}
              className={`min-h-9 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                active ? 'bg-nb-green text-white border-nb-green' : 'bg-nb-paper text-nb-ink border-nb-rule hover:border-nb-green'
              }`}
            >
              {label} <span className={active ? 'opacity-90' : 'text-nb-ink-muted'}>({counts[f]})</span>
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <LoadingSpinner text="Memuat Sampah..." />
      ) : items.length === 0 ? (
        <Card className="text-center space-y-2 py-10">
          <div className="w-14 h-14 mx-auto rounded-full bg-nb-workspace flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-nb-ink-muted" />
          </div>
          <h3 className="text-sm font-extrabold text-nb-ink">
            {filter === 'all' ? 'Sampah kosong' : `Tidak ada ${KIND_META[filter as BinKind].plural.toLowerCase()} terhapus`}
          </h3>
          <p className="text-xs text-nb-ink-muted max-w-xs mx-auto">Yang Anda hapus akan muncul di sini dan bisa dipulihkan kapan saja.</p>
        </Card>
      ) : (
        <ul className="bg-nb-paper rounded-3xl shadow-sm border border-nb-rule divide-y divide-gray-100 overflow-hidden" aria-label="Item terhapus">
          {items.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            const busy = busyKey === item.key;
            return (
              <li key={item.key} data-testid="bin-item" data-kind={item.kind} className="flex items-center gap-3 p-4">
                <div className={`w-10 h-10 rounded-2xl ${meta.tone} text-white flex items-center justify-center shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-nb-ink truncate">{item.title}</p>
                  <p className="text-xs text-nb-ink-muted truncate">
                    {item.kind === 'class' ? `Kelas · ${item.detail}` : item.detail}
                  </p>
                  <p className="text-[11px] text-nb-ink-muted">
                    Dihapus {formatDeleted(item.deletedAt)}
                    {item.deletedBy && item.deletedBy === uid ? ' oleh Anda' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(item)}
                  disabled={busyKey !== null}
                  aria-label={`Pulihkan ${item.title}`}
                  className="shrink-0 min-h-11 inline-flex items-center gap-1.5 px-3.5 rounded-2xl bg-nb-green hover:bg-nb-green-strong disabled:bg-[#DDE3D8] disabled:text-[#5D665E] text-white text-xs font-bold transition-colors active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-green"
                >
                  <RotateCcw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                  {busy ? 'Memulihkan…' : 'Pulihkan'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
