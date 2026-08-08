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
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
        <History className="w-4 h-4 text-blue-600" />
        Riwayat Jurnal ({entries.length} Catatan)
      </h3>

      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
          Belum ada riwayat jurnal untuk kelas ini.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map((item) => (
            <div
              key={item.id}
              className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                    {item.date}
                  </span>
                  <span className="text-xs font-bold text-gray-900">• {item.subject}</span>
                </div>
                <p className="text-xs font-extrabold text-gray-800">{item.topic}</p>
                <p className="text-[11px] text-gray-500">Catatan: {item.notes}</p>
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
