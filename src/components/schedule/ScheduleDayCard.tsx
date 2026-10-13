'use client';

import React from 'react';
import { Calendar, Trash2 } from 'lucide-react';
import Link from 'next/link';

type ScheduleItem = {
  id: string;
  day: string;
  timeSlot: string;
  className: string;
  subject: string;
};

type ScheduleDayCardProps = {
  day: string;
  items: ScheduleItem[];
  onRequestDelete: (id: string) => void;
};

export default function ScheduleDayCard({ day, items, onRequestDelete }: ScheduleDayCardProps) {
  return (
    <div className="bg-[#FFFEF9] p-5 rounded-3xl border border-[#D9DED5] shadow-sm space-y-3">
      <div className="flex justify-between items-center border-b border-[#D9DED5] pb-3">
        <h3 className="text-sm font-extrabold text-[#2F6B4F] uppercase tracking-wider flex items-center gap-1.5">
          <Calendar className="w-4 h-4" />
          <span>{day}</span>
        </h3>
        <span className="text-xs font-bold text-[#5D665E] bg-[#F7F5EF] px-2 py-1 rounded-full">
          {items.length} Kelas
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-nb-ink-muted py-6 text-center italic">Tidak ada jadwal mengajar.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-3 bg-[#F7F5EF] hover:bg-[#F0EEE6] rounded-2xl border border-[#D9DED5] flex justify-between items-center transition-colors"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-extrabold text-[#242923]">Kelas {item.className}</p>
                <p className="text-xs font-bold text-[#2F6B4F]">{item.timeSlot}</p>
                <p className="text-xs text-nb-ink-muted">{item.subject}</p>
              </div>

              <div className="flex items-center gap-1">
                <Link
                  href="/attendance"
                  className="px-3 py-2 bg-[#2F6B4F] hover:bg-[#24563F] text-white rounded-xl text-xs font-bold transition-colors active:scale-95 shadow-sm"
                >
                  Mulai
                </Link>
                <button
                  onClick={() => onRequestDelete(item.id)}
                  className="p-3.5 text-red-400 hover:text-red-600 rounded-lg transition-colors active:scale-90"
                  title="Hapus Jadwal"
                  aria-label="Hapus Jadwal"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
