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
    <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-3">
      <div className="flex justify-between items-center border-b border-gray-100 pb-3">
        <h3 className="text-xs font-extrabold text-blue-600 uppercase tracking-wider flex items-center gap-1.5">
          <Calendar className="w-4 h-4" />
          <span>{day}</span>
        </h3>
        <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
          {items.length} Kelas
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-gray-400 py-6 text-center italic">Tidak ada jadwal mengajar.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-3 bg-gray-50 hover:bg-gray-100/80 rounded-2xl border border-gray-100 flex justify-between items-center transition-colors"
            >
              <div className="space-y-0.5">
                <p className="text-xs font-extrabold text-gray-900">Kelas {item.className}</p>
                <p className="text-[10px] font-bold text-blue-600">{item.timeSlot}</p>
                <p className="text-[10px] text-gray-500">{item.subject}</p>
              </div>

              <div className="flex items-center gap-1">
                <Link
                  href="/attendance"
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-bold transition-colors shadow-sm"
                >
                  Mulai
                </Link>
                <button
                  onClick={() => onRequestDelete(item.id)}
                  className="p-1.5 text-red-400 hover:text-red-600 rounded-lg transition-colors"
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
