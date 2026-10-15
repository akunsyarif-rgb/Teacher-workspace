'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react';
import { resolveSubmissionAttachmentUrl } from '@/lib/adapters/supabaseSubmissionStorage';

export type ViewerAttachment = { fileUrl: string; fileName?: string; filePath?: string };

type Kind = 'image' | 'pdf' | 'other';

function kindOf(name?: string): Kind {
  const ext = (name || '').toLowerCase().split('.').pop() || '';
  if (['jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

/**
 * Hook: `open(att, group?)` menampilkan lampiran di modal pada halaman yang
 * sama. Jika `group` (semua lampiran satu pengumpulan) diberikan, pengguna
 * bisa berpindah antar-lampiran tanpa menutup modal.
 */
export function useAttachmentViewer() {
  const [state, setState] = useState<{ group: ViewerAttachment[]; index: number } | null>(null);
  const open = useCallback((att: ViewerAttachment, group?: ViewerAttachment[]) => {
    const list = group && group.length > 0 ? group : [att];
    const found = list.findIndex((item) => (item.filePath || item.fileUrl) === (att.filePath || att.fileUrl));
    setState({ group: list, index: found >= 0 ? found : 0 });
  }, []);
  const close = useCallback(() => setState(null), []);
  const go = useCallback((delta: number) => setState((prev) => {
    if (!prev) return prev;
    const next = prev.index + delta;
    return next < 0 || next >= prev.group.length ? prev : { ...prev, index: next };
  }), []);
  const current = state ? state.group[state.index] : null;
  // key: komponen dibuat ulang per lampiran, jadi state url/error/zoom mulai bersih.
  const viewer = state && current ? (
    <AttachmentViewer
      key={`${current.filePath || current.fileUrl}`}
      attachment={current}
      onClose={close}
      position={{ index: state.index, total: state.group.length }}
      onNavigate={go}
    />
  ) : null;
  return { open, viewer };
}

type AttachmentViewerProps = {
  attachment: ViewerAttachment | null;
  onClose: () => void;
  position?: { index: number; total: number };
  onNavigate?: (delta: number) => void;
};

export default function AttachmentViewer({ attachment, onClose, position, onNavigate }: AttachmentViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const total = position?.total ?? 1;
  const index = position?.index ?? 0;
  const zoomBy = (delta: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));

  useEffect(() => {
    if (!attachment) return;
    let cancelled = false;
    resolveSubmissionAttachmentUrl(attachment.fileUrl, attachment.filePath)
      .then((resolved) => { if (!cancelled) setUrl(resolved); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Lampiran belum bisa dibuka. Coba lagi.'); });
    return () => { cancelled = true; };
  }, [attachment]);

  useEffect(() => {
    if (!attachment) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onNavigate?.(-1);
      else if (e.key === 'ArrowRight') onNavigate?.(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attachment, onClose, onNavigate]);

  if (!attachment) return null;
  const kind = kindOf(attachment.fileName || attachment.filePath);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-nb-paper rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={attachment.fileName || 'Lampiran'}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-nb-rule shrink-0">
          <h3 className="text-sm font-bold text-nb-ink truncate">
            {attachment.fileName || 'Lampiran'}
            {total > 1 && <span className="ml-2 text-xs font-semibold text-nb-ink-muted">{index + 1} / {total}</span>}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {kind === 'image' && url && (
              <>
                <button type="button" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} className="p-2 text-nb-ink-muted rounded-xl disabled:opacity-30" aria-label="Perkecil">
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setZoom(MIN_ZOOM)} className="px-1 text-xs font-bold text-nb-ink-muted tabular-nums" aria-label="Atur ulang zoom">
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} className="p-2 text-nb-ink-muted rounded-xl disabled:opacity-30" aria-label="Perbesar">
                  <ZoomIn className="w-4 h-4" />
                </button>
              </>
            )}
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="p-2 text-nb-ink-muted hover:text-nb-ink-muted rounded-xl" aria-label="Buka di tab baru">
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button type="button" onClick={onClose} className="p-2 text-nb-ink-muted hover:text-nb-ink-muted rounded-xl" aria-label="Tutup">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="relative flex-1 overflow-auto bg-nb-workspace min-h-[40vh]" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
          {total > 1 && (
            <>
              <button type="button" onClick={() => onNavigate?.(-1)} disabled={index === 0} className="fixed left-5 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/50 text-white disabled:opacity-20" aria-label="Lampiran sebelumnya">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button type="button" onClick={() => onNavigate?.(1)} disabled={index === total - 1} className="fixed right-5 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/50 text-white disabled:opacity-20" aria-label="Lampiran berikutnya">
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
          <div className="min-h-[40vh] min-w-full w-max flex items-center justify-center">
          {error ? (
            <p className="text-xs font-bold text-red-600 p-6 text-center">{error}</p>
          ) : !url ? (
            <p className="text-xs text-nb-ink-muted p-6">Memuat lampiran…</p>
          ) : kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={attachment.fileName || 'Lampiran'}
              className="object-contain"
              style={zoom === MIN_ZOOM ? { maxWidth: '100%', maxHeight: '80vh' } : { width: `${zoom * 100}vw`, maxWidth: `${zoom * 48}rem`, maxHeight: 'none' }}
            />
          ) : kind === 'pdf' ? (
            <div className="w-full min-w-[min(100vw,48rem)] flex flex-col">
              {/* Safari iPad/iPhone hanya menampilkan halaman pertama PDF di iframe
                  dan zoom-nya terbatas; tab baru memakai penampil PDF bawaan. */}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="m-3 flex items-center justify-center gap-2 rounded-xl bg-nb-green px-4 py-2.5 text-xs font-bold text-white"
              >
                <ExternalLink className="w-4 h-4" />
                Buka PDF layar penuh (semua halaman & zoom)
              </a>
              <iframe src={url} title={attachment.fileName || 'Lampiran PDF'} className="w-full h-[75vh] border-0" />
            </div>
          ) : (
            <div className="p-6 text-center space-y-3">
              <p className="text-xs text-nb-ink-muted">Jenis file ini tidak bisa ditampilkan langsung.</p>
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-bold text-nb-green hover:underline">
                Buka / unduh file
              </a>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
