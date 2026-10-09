'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { resolveSubmissionAttachmentUrl } from '@/lib/adapters/supabaseSubmissionStorage';

export type ViewerAttachment = { fileUrl: string; fileName?: string; filePath?: string };

type Kind = 'image' | 'pdf' | 'other';

function kindOf(name?: string): Kind {
  const ext = (name || '').toLowerCase().split('.').pop() || '';
  if (['jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

/** Hook: `open(att)` menampilkan lampiran di modal pada halaman yang sama. */
export function useAttachmentViewer() {
  const [attachment, setAttachment] = useState<ViewerAttachment | null>(null);
  const open = useCallback((att: ViewerAttachment) => setAttachment(att), []);
  // key: komponen dibuat ulang per lampiran, jadi state url/error mulai bersih.
  const viewer = attachment ? (
    <AttachmentViewer key={`${attachment.filePath || attachment.fileUrl}`} attachment={attachment} onClose={() => setAttachment(null)} />
  ) : null;
  return { open, viewer };
}

export default function AttachmentViewer({ attachment, onClose }: { attachment: ViewerAttachment | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attachment, onClose]);

  if (!attachment) return null;
  const kind = kindOf(attachment.fileName || attachment.filePath);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-white rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={attachment.fileName || 'Lampiran'}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100 shrink-0">
          <h3 className="text-sm font-bold text-gray-900 truncate">{attachment.fileName || 'Lampiran'}</h3>
          <div className="flex items-center gap-1 shrink-0">
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="p-2 text-gray-400 hover:text-gray-600 rounded-xl" aria-label="Buka di tab baru">
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl" aria-label="Tutup">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-gray-50 flex items-center justify-center min-h-[40vh]">
          {error ? (
            <p className="text-xs font-bold text-red-600 p-6 text-center">{error}</p>
          ) : !url ? (
            <p className="text-xs text-gray-400 p-6">Memuat lampiran…</p>
          ) : kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={attachment.fileName || 'Lampiran'} className="max-w-full max-h-[80vh] object-contain" />
          ) : kind === 'pdf' ? (
            <iframe src={url} title={attachment.fileName || 'Lampiran PDF'} className="w-full h-[80vh] border-0" />
          ) : (
            <div className="p-6 text-center space-y-3">
              <p className="text-xs text-gray-500">Jenis file ini tidak bisa ditampilkan langsung.</p>
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-bold text-blue-600 hover:underline">
                Buka / unduh file
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
