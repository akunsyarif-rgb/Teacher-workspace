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

function HistoryBadge({ detail }: { detail?: { status: string; late?: boolean } }) {
  if (!detail) {
    return <span className="inline-flex w-6 h-6 rounded-lg border border-dashed border-gray-200" />;
  }
  const bg = STATUS_COLOR[detail.status] || 'bg-gray-300';
  return (
    <span
      className="relative inline-flex w-6 h-6 shrink-0"
      title={`${detail.status}${detail.late ? ' (Terlambat)' : ''}`}
    >
      <span
        className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-extrabold text-white ${bg}`}
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
    <div className="flex items-center gap-1 flex-wrap">
      {ATTENDANCE_STATUS_OPTIONS.map((option) => {
        const isActive = value.status === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange({ status: option, late: option === 'Hadir' ? value.late : false })}
            title={option}
            className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-extrabold transition-colors ${
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
        className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
          value.status !== 'Hadir'
            ? 'bg-gray-50 text-gray-200 cursor-not-allowed'
            : value.late
            ? `${LATE_COLOR} text-white shadow-sm`
            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
        }`}
      >
        <Clock className="w-3 h-3" />
      </button>
    </div>
  );
}

// Grid presensi: nama siswa (sticky kiri) -> riwayat kehadiran penuh
// (scroll horizontal, jumlah kolom mengikuti jumlah pertemuan yang sudah
// berlangsung, bukan slot tetap) -> input hari ini (sticky kanan). Ini
// gabungan spreadsheet (riwayat lengkap sekali lihat) dan input cepat
// satu-tap ala aplikasi mobile, sesuai konsep yang didiskusikan.
export default function AttendanceGrid({ students, history, statusMap, onChange }: AttendanceGridProps) {
  const sortedHistory = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100 -mx-1">
      <table className="border-collapse text-xs w-full">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2.5 font-bold text-gray-500 min-w-[180px]">
              Nama Siswa
            </th>
            {sortedHistory.map((session, i) => (
              <th
                key={session.id}
                className="px-1 py-2.5 text-center font-bold text-gray-400 w-8"
                title={session.date}
              >
                <div>{i + 1}</div>
                <div className="text-[8px] font-medium text-gray-300">{formatShortDate(session.date)}</div>
              </th>
            ))}
            <th className="sticky right-0 z-20 bg-gray-50 border-l-2 border-gray-200 px-2.5 py-2.5 text-center font-bold text-gray-500 min-w-[190px]">
              Hari Ini
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((student, idx) => {
            const entry = statusMap[student.id] || { status: 'Hadir', late: false };
            return (
              <tr key={student.id} className="border-t border-gray-100">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-bold text-gray-900 whitespace-nowrap">
                  <span className="text-gray-400 font-normal mr-1.5">{idx + 1}.</span>
                  {student.name}
                </td>
                {sortedHistory.map((session) => {
                  const detail = (session.details || []).find((d) => d.studentId === student.id);
                  return (
                    <td key={session.id} className="px-1 py-2 text-center">
                      <HistoryBadge detail={detail} />
                    </td>
                  );
                })}
                <td className="sticky right-0 z-10 bg-white border-l-2 border-gray-200 px-2.5 py-2">
                  <TodayStatusControl value={entry} onChange={(next) => onChange(student.id, next)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
