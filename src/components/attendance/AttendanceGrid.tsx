'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import { ATTENDANCE_STATUS_OPTIONS } from '@/lib/config/constants';
import { STATUS_LETTER, STATUS_COLOR, LATE_COLOR } from '@/lib/utils/attendanceStatus';

export type TodayEntry = { status: string; late: boolean };

type Session = {
  id: string;
  date: string;
  details?: { studentId: string; status: string; late?: boolean }[];
};

type AttendanceGridProps = {
  students: { id: string; name: string; nis?: string }[];
  history: Session[];
  statusMap: Record<string, TodayEntry>;
  onChange: (studentId: string, next: TodayEntry) => void;
};

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function HistoryBadge({ detail, date }: { detail?: { status: string; late?: boolean }; date: string }) {
  if (!detail) {
    return (
      <span
        className="inline-flex shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-lg border border-dashed border-gray-200"
        title={date}
      />
    );
  }
  const bg = STATUS_COLOR[detail.status] || 'bg-gray-300';
  return (
    <span
      className="relative inline-flex shrink-0 w-6 h-6 sm:w-7 sm:h-7"
      title={`${formatShortDate(date)} — ${detail.status}${detail.late ? ' (Terlambat)' : ''}`}
      aria-label={`${formatShortDate(date)}: ${detail.status}${detail.late ? ' (Terlambat)' : ''}`}
    >
      <span
        className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center text-[10px] sm:text-[11px] font-extrabold text-white ${bg}`}
      >
        {STATUS_LETTER[detail.status] || '?'}
      </span>
      {detail.late && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-orange-500 border border-white flex items-center justify-center">
          <Clock className="w-2 h-2 text-white" />
        </span>
      )}
    </span>
  );
}

function TodayStatusControl({ value, onChange }: { value: TodayEntry; onChange: (next: TodayEntry) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {ATTENDANCE_STATUS_OPTIONS.map((option) => {
        const isActive = value.status === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange({ status: option, late: option === 'Hadir' ? value.late : false })}
            title={option}
            aria-label={option}
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center text-xs font-extrabold transition-all active:scale-90 ${
              isActive ? `${STATUS_COLOR[option]} text-white shadow-sm` : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
            }`}
          >
            {STATUS_LETTER[option]}
          </button>
        );
      })}
      <button
        type="button"
        disabled={value.status !== 'Hadir'}
        onClick={() => onChange({ ...value, late: !value.late })}
        title="Terlambat (hanya berlaku untuk Hadir)"
        aria-label="Terlambat (hanya berlaku untuk Hadir)"
        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center transition-all active:scale-90 ${
          value.status !== 'Hadir'
            ? 'bg-gray-50 text-gray-200 cursor-not-allowed'
            : value.late
            ? `${LATE_COLOR} text-white shadow-sm`
            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
        }`}
      >
        <Clock className="w-4 h-4" />
      </button>
    </div>
  );
}

// Satu kartu per siswa — nama di atas, riwayat kehadiran tepat di
// bawahnya (strip badge yang bisa discroll horizontal sendiri kalau
// riwayatnya panjang), lalu status hari ini di baris paling bawah.
//
// Sebelumnya nama/riwayat/status-hari-ini disusun sebagai satu baris
// spreadsheet dengan nama & status-hari-ini sticky di kiri-kanan.
// Itu ternyata cacat: `position: sticky` di kedua sisi tidak saling
// menyisakan ruang untuk kolom riwayat di tengah — pada scroll awal,
// tombol status hari ini (sticky kanan) selalu menumpuk tepat di
// belakang kolom riwayat pertama (background putihnya menutupi badge
// riwayat), bukan cuma pada kelas dengan sedikit pertemuan seperti
// dugaan awal. Layout kartu ini tidak pakai sticky sama sekali —
// tidak ada dua elemen yang berebut ruang horizontal yang sama,
// jadi tidak mungkin tumpang tindih lagi.
export default function AttendanceGrid({ students, history, statusMap, onChange }: AttendanceGridProps) {
  const sortedHistory = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return (
    <div className="space-y-2.5">
      {students.map((student, idx) => {
        const entry = statusMap[student.id] || { status: 'Hadir', late: false };
        return (
          <div key={student.id} className="bg-white rounded-2xl border border-gray-100 p-3 space-y-2.5">
            <p className="font-bold text-sm text-gray-900">
              <span className="text-gray-400 font-normal mr-1.5">{idx + 1}.</span>
              {student.name}
            </p>

            {sortedHistory.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Riwayat</span>
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {sortedHistory.map((session) => {
                    const detail = (session.details || []).find((d) => d.studentId === student.id);
                    return <HistoryBadge key={session.id} detail={detail} date={session.date} />;
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <span className="shrink-0 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Hari Ini</span>
              <TodayStatusControl value={entry} onChange={(next) => onChange(student.id, next)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
