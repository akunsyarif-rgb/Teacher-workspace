import React from 'react';
import { RotateCcw, Users, GraduationCap, ClipboardList, Table2, Trash2, CheckCircle2, Eraser } from 'lucide-react';
import Card from '../ui/Card';
import InlineAlert from '../ui/InlineAlert';
import LoadingSpinner from '../ui/LoadingSpinner';
import type { BinItem, BinKind } from '@/lib/controllers/recycleBinController';

// Tampilan murni (tanpa state/efek) Recycle Bin — dipisah dari RecycleBinPanel supaya aturan
// "siapa melihat tombol apa" dapat diuji langsung (tests/recycle-bin-view.test.ts).
export type Filter = 'all' | BinKind;

export const KIND_META: Record<BinKind, { label: string; plural: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  class: { label: 'Kelas', plural: 'Kelas', icon: GraduationCap, tone: 'bg-emerald-600' },
  student: { label: 'Siswa', plural: 'Siswa', icon: Users, tone: 'bg-nb-green' },
  assignment: { label: 'Tugas', plural: 'Tugas', icon: ClipboardList, tone: 'bg-amber-600' },
  column: { label: 'Kolom nilai', plural: 'Kolom nilai', icon: Table2, tone: 'bg-sky-700' },
};

export const FILTER_ORDER: Filter[] = ['all', 'class', 'student', 'assignment', 'column'];

export function formatDeleted(ms: number | null): string {
  if (ms === null) return 'Tanggal tidak diketahui';
  return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export type RecycleBinViewProps = {
  items: BinItem[];
  counts: Record<Filter, number>;
  filter: Filter;
  loading: boolean;
  uid: string;
  busyKey: string | null;
  /** OWNER/ADMIN saja: menampilkan "Hapus Permanen" dan "Kosongkan Sampah". */
  canPurge: boolean;
  notice: string;
  error: string;
  onFilter: (f: Filter) => void;
  onDismissError: () => void;
  onRestore: (item: BinItem) => void;
  onPurge: (item: BinItem) => void;
  onEmpty: () => void;
};

export default function RecycleBinView(props: RecycleBinViewProps) {
  const { items, counts, filter, loading, uid, busyKey, canPurge, notice, error } = props;

  return (
    <div className="space-y-4">
      <Card className="space-y-1">
        <p className="text-xs text-nb-ink-muted">
          Siswa, tugas, kolom nilai, dan kelas yang dihapus disimpan di sini dan bisa dipulihkan beserta isinya.
          {canPurge
            ? ' Sebagai pemilik/admin Anda melihat semuanya dan bisa menghapus permanen — itu tidak dapat dibatalkan.'
            : ' Guru biasa hanya melihat item yang ia buat sendiri; pemilik dan admin melihat semuanya.'}
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
      <InlineAlert message={error} onDismiss={props.onDismissError} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Saring jenis item">
          {FILTER_ORDER.map((f) => {
            const label = f === 'all' ? 'Semua' : KIND_META[f].plural;
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={() => props.onFilter(f)}
                className={`min-h-9 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  active ? 'bg-nb-green text-white border-nb-green' : 'bg-nb-paper text-nb-ink border-nb-rule hover:border-nb-green'
                }`}
              >
                {label} <span className={active ? 'opacity-90' : 'text-nb-ink-muted'}>({counts[f]})</span>
              </button>
            );
          })}
        </div>
        {canPurge && counts.all > 0 && (
          <button
            type="button"
            onClick={props.onEmpty}
            disabled={busyKey !== null}
            className="min-h-9 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border border-red-200 text-red-600 bg-nb-paper hover:bg-red-50 disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            <Eraser className="w-3.5 h-3.5" />
            Kosongkan Sampah
          </button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner text="Memuat Sampah..." />
      ) : items.length === 0 ? (
        <Card className="text-center space-y-2 py-10">
          <div className="w-14 h-14 mx-auto rounded-full bg-nb-workspace flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-nb-ink-muted" />
          </div>
          <h3 className="text-sm font-extrabold text-nb-ink">
            {filter === 'all' ? 'Sampah kosong' : `Tidak ada ${KIND_META[filter as BinKind].plural.toLowerCase()} terhapus`}
          </h3>
          <p className="text-xs text-nb-ink-muted max-w-xs mx-auto">Yang dihapus akan muncul di sini dan bisa dipulihkan kapan saja.</p>
        </Card>
      ) : (
        <ul className="bg-nb-paper rounded-3xl shadow-sm border border-nb-rule divide-y divide-gray-100 overflow-hidden" aria-label="Item terhapus">
          {items.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            const busy = busyKey === item.key;
            return (
              <li key={item.key} data-testid="bin-item" data-kind={item.kind} className="flex flex-wrap items-center gap-3 p-4">
                <div className={`w-10 h-10 rounded-2xl ${meta.tone} text-white flex items-center justify-center shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-[9rem] flex-1">
                  <p className="text-sm font-extrabold text-nb-ink truncate">{item.title}</p>
                  <p className="text-xs text-nb-ink-muted truncate">{item.kind === 'class' ? `Kelas · ${item.detail}` : item.detail}</p>
                  <p className="text-[11px] text-nb-ink-muted">
                    Dihapus {formatDeleted(item.deletedAt)}
                    {item.deletedBy && item.deletedBy === uid ? ' oleh Anda' : ''}
                  </p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => props.onRestore(item)}
                    disabled={busyKey !== null}
                    aria-label={`Pulihkan ${item.title}`}
                    className="flex-1 sm:flex-none min-h-11 inline-flex items-center justify-center gap-1.5 px-3.5 rounded-2xl bg-nb-green hover:bg-nb-green-strong disabled:bg-[#DDE3D8] disabled:text-[#5D665E] text-white text-xs font-bold transition-colors active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-green"
                  >
                    <RotateCcw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                    {busy ? 'Memulihkan…' : 'Pulihkan'}
                  </button>
                  {canPurge && (
                    <button
                      type="button"
                      onClick={() => props.onPurge(item)}
                      disabled={busyKey !== null}
                      aria-label={`Hapus permanen ${item.title}`}
                      className="flex-1 sm:flex-none min-h-11 inline-flex items-center justify-center gap-1.5 px-3.5 rounded-2xl border border-red-200 bg-nb-paper hover:bg-red-50 disabled:opacity-50 text-red-600 text-xs font-bold transition-colors active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                      Hapus Permanen
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
