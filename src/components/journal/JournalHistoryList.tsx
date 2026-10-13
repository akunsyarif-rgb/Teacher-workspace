'use client';

import React from 'react';
import { History, Trash2 } from 'lucide-react';

type JournalEntry = {
  id: string;
  date: string;
  subject: string;
  topic: string;
  notes: string;
};

type JournalHistoryListProps = {
  entries: JournalEntry[];
  onDelete: (id: string) => void;
};

export default function JournalHistoryList({ entries, onDelete }: JournalHistoryListProps) {
  return (
    <div className="bg-nb-paper p-6 rounded-3xl border border-nb-rule shadow-sm space-y-4">
      <h3 className="text-sm font-bold text-nb-ink flex items-center gap-2">
        <History className="w-4 h-4 text-nb-green" />
        Riwayat Jurnal ({entries.length} Catatan)
      </h3>

      {entries.length === 0 ? (
        <p className="text-xs text-nb-ink-muted py-8 text-center bg-nb-workspace rounded-2xl border border-dashed border-nb-rule">
          Belum ada riwayat jurnal untuk kelas ini.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map((item) => (
            <div
              key={item.id}
              className="p-4 bg-nb-workspace rounded-2xl border border-nb-rule flex flex-col md:flex-row justify-between items-start md:items-center gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold text-nb-green bg-nb-green-soft px-2 py-0.5 rounded-md">
                    {item.date}
                  </span>
                  <span className="text-xs font-bold text-nb-ink">• {item.subject}</span>
                </div>
                <p className="text-xs font-extrabold text-nb-ink">{item.topic}</p>
                <p className="text-xs text-nb-ink-muted">Catatan: {item.notes}</p>
              </div>
              <button
                onClick={() => onDelete(item.id)}
                className="p-3.5 text-red-500 hover:bg-red-50 rounded-xl transition-colors active:scale-90 self-end md:self-auto"
                title="Hapus Jurnal"
                aria-label="Hapus Jurnal"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
