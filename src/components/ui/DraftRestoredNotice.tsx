'use client';

import React from 'react';

type Props = {
  message: string;
  onDiscard?: () => void;
  onDismiss: () => void;
  testId?: string;
};

// Pemberitahuan seragam: isi formulir dipulihkan dari draf di perangkat ini.
export default function DraftRestoredNotice({ message, onDiscard, onDismiss, testId = 'draft-restored-notice' }: Props) {
  return (
    <div role="status" data-testid={testId} className="p-3 bg-amber-50 text-amber-800 rounded-2xl text-xs font-medium flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
      <span>{message}</span>
      <span className="flex gap-2 shrink-0">
        {onDiscard && (
          <button type="button" onClick={onDiscard} className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 font-bold">
            Buang draf
          </button>
        )}
        <button type="button" onClick={onDismiss} className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 font-bold">
          Tutup
        </button>
      </span>
    </div>
  );
}
