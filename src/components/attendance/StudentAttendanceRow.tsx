'use client';

import React from 'react';
import { ATTENDANCE_STATUS_OPTIONS } from '@/lib/config/constants';

type StudentAttendanceRowProps = {
  student: { id: string; name: string; nis?: string };
  index: number;
  status: string;
  onStatusChange: (studentId: string, status: string) => void;
  recentHistory?: { date: string; status: string }[];
};

const ACTIVE_COLOR: Record<string, string> = {
  Hadir: 'bg-blue-600 text-white shadow-sm',
  Sakit: 'bg-amber-500 text-white shadow-sm',
  Izin: 'bg-purple-600 text-white shadow-sm',
  Dispensasi: 'bg-teal-600 text-white shadow-sm',
  Alpa: 'bg-red-600 text-white shadow-sm',
};

const DOT_COLOR: Record<string, string> = {
  Hadir: 'bg-blue-500',
  Sakit: 'bg-amber-500',
  Izin: 'bg-purple-500',
  Dispensasi: 'bg-teal-500',
  Alpa: 'bg-red-500',
};

const HISTORY_SLOTS = 5;

// Selalu tampilkan 5 slot (terisi warna atau lingkaran kosong) supaya strip
// ini konsisten terlihat sebagai elemen baru, bukan hanya teks kecil yang
// gampang tidak diperhatikan saat siswa belum punya riwayat sama sekali.
function RecentHistoryStrip({ recentHistory }: { recentHistory: { date: string; status: string }[] }) {
  const padded = Array.from(
    { length: HISTORY_SLOTS },
    (_, i) => recentHistory[recentHistory.length - HISTORY_SLOTS + i] || null
  );

  return (
    <div className="flex items-center gap-1" title="Riwayat presensi 5 pertemuan terakhir">
      {padded.map((h, i) =>
        h ? (
          <span
            key={i}
            className={`w-2.5 h-2.5 rounded-full ${DOT_COLOR[h.status] || 'bg-gray-300'}`}
            title={`${h.date}: ${h.status}`}
          />
        ) : (
          <span key={i} className="w-2.5 h-2.5 rounded-full border border-gray-200" title="Belum ada data" />
        )
      )}
    </div>
  );
}

export default function StudentAttendanceRow({
  student,
  index,
  status,
  onStatusChange,
  recentHistory = [],
}: StudentAttendanceRowProps) {
  return (
    <div className="py-3 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
      <div className="flex items-center gap-3">
        <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 font-bold text-xs flex items-center justify-center">
          {index + 1}
        </span>
        <div className="space-y-1">
          <p className="text-xs font-bold text-gray-900">{student.name}</p>
          <p className="text-[10px] text-gray-400">NIS: {student.nis || '-'}</p>
          <RecentHistoryStrip recentHistory={recentHistory} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1 self-end md:self-auto">
        {ATTENDANCE_STATUS_OPTIONS.map((option) => {
          const isActive = status === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onStatusChange(student.id, option)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                isActive ? ACTIVE_COLOR[option] : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
