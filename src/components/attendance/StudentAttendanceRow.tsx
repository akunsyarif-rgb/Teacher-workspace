'use client';

import React from 'react';
import { ATTENDANCE_STATUS_OPTIONS } from '@/lib/config/constants';
import { STATUS_LETTER, STATUS_COLOR as DOT_COLOR } from '@/lib/utils/attendanceStatus';

type StudentAttendanceRowProps = {
  student: { id: string; name: string; nis?: string };
  index: number;
  status: string;
  onStatusChange: (studentId: string, status: string) => void;
  recentHistory?: { date: string; status: string }[];
};

// Warna dinaikkan ke shade 600/700 (bukan 500) di kombinasi teks putih —
// shade 500 gagal rasio kontras WCAG AA (di bawah 4.5:1) untuk teks kecil
// tebal seperti label tombol status ini.
const ACTIVE_COLOR: Record<string, string> = {
  Hadir: 'bg-blue-600 text-white shadow-sm',
  Terlambat: 'bg-orange-700 text-white shadow-sm',
  Sakit: 'bg-amber-700 text-white shadow-sm',
  Izin: 'bg-purple-600 text-white shadow-sm',
  Dispensasi: 'bg-teal-700 text-white shadow-sm',
  Alpa: 'bg-red-700 text-white shadow-sm',
};

const HISTORY_SLOTS = 5;

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// Selalu tampilkan 5 slot (terisi atau kosong) supaya strip ini konsisten
// terlihat sebagai elemen baru. Kode huruf (H/S/I/D/A) + tanggal kecil di
// atasnya, meniru format rekap kehadiran (siswa x pertemuan) yang biasa
// dipakai guru, tapi tetap ringkas untuk ditaruh di layar presensi harian.
function RecentHistoryStrip({ recentHistory }: { recentHistory: { date: string; status: string }[] }) {
  const padded = Array.from(
    { length: HISTORY_SLOTS },
    (_, i) => recentHistory[recentHistory.length - HISTORY_SLOTS + i] || null
  );

  return (
    <div
      className="flex items-end gap-1"
      title="Riwayat presensi 5 pertemuan terakhir"
      aria-label="Riwayat presensi 5 pertemuan terakhir"
    >
      {padded.map((h, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          <span className="text-[7px] leading-none text-gray-400">{h ? formatShortDate(h.date) : ''}</span>
          <span
            className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-extrabold leading-none ${
              h ? `${DOT_COLOR[h.status] || 'bg-gray-400'} text-white` : 'bg-gray-50 text-gray-300 border border-gray-200'
            }`}
            title={h ? `${h.date}: ${h.status}` : 'Belum ada data'}
            aria-label={h ? `${h.date}: ${h.status}` : 'Belum ada data'}
          >
            {h ? STATUS_LETTER[h.status] || '?' : '·'}
          </span>
        </div>
      ))}
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
          <p className="text-sm font-bold text-gray-900">{student.name}</p>
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
              className={`px-2.5 py-1.5 rounded-xl text-sm font-bold transition-all ${
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
