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

// Lebar kolom tetap (mobile / sm+) — dipakai konsisten oleh header & baris
// data supaya kolomnya sejajar. Pakai flex row biasa (bukan <table>):
// table-layout browser (auto maupun fixed) terbukti tidak bisa diandalkan
// untuk mempertahankan lebar kolom yang presisi saat ada sel sticky +
// konten yang tidak bisa dipotong (nama siswa panjang) — kolom sticky
// jadi ikut membengkak dan menutupi kolom riwayat di layar sempit. Flex
// row dengan shrink-0 di tiap sel memberi kontrol lebar yang deterministik.
const NAME_COL = 'w-[96px] sm:w-[180px] shrink-0';
const HISTORY_COL = 'w-[30px] sm:w-[36px] shrink-0';
const TODAY_COL = 'w-[232px] sm:w-[272px] shrink-0';

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function HistoryBadge({ detail }: { detail?: { status: string; late?: boolean } }) {
  if (!detail) {
    return <span className="inline-flex w-6 h-6 sm:w-7 sm:h-7 rounded-lg border border-dashed border-gray-200" />;
  }
  const bg = STATUS_COLOR[detail.status] || 'bg-gray-300';
  return (
    <span
      className="relative inline-flex w-6 h-6 sm:w-7 sm:h-7 shrink-0"
      title={`${detail.status}${detail.late ? ' (Terlambat)' : ''}`}
      aria-label={`${detail.status}${detail.late ? ' (Terlambat)' : ''}`}
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
    <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
      {ATTENDANCE_STATUS_OPTIONS.map((option) => {
        const isActive = value.status === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange({ status: option, late: option === 'Hadir' ? value.late : false })}
            title={option}
            aria-label={option}
            className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-[10px] sm:text-xs font-extrabold transition-all active:scale-90 ${
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
        className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center transition-all active:scale-90 ${
          value.status !== 'Hadir'
            ? 'bg-gray-50 text-gray-200 cursor-not-allowed'
            : value.late
            ? `${LATE_COLOR} text-white shadow-sm`
            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
        }`}
      >
        <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
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
    <div className="overflow-x-auto rounded-2xl border border-gray-100 -mx-1 text-xs">
      <div className="w-fit min-w-full">
        <div className="flex bg-gray-50">
          <div className={`sticky left-0 z-20 bg-gray-50 text-left px-2 sm:px-3 py-2.5 font-bold text-gray-500 ${NAME_COL}`}>
            Nama Siswa
          </div>
          {sortedHistory.map((session, i) => (
            <div
              key={session.id}
              className={`px-0.5 sm:px-1 py-2.5 text-center font-bold text-gray-400 ${HISTORY_COL}`}
              title={session.date}
            >
              <div>{i + 1}</div>
              <div className="text-[8px] font-medium text-gray-300">{formatShortDate(session.date)}</div>
            </div>
          ))}
          <div className={`sticky right-0 z-20 bg-gray-50 border-l-2 border-gray-200 px-1.5 sm:px-2.5 py-2.5 text-center font-bold text-gray-500 ${TODAY_COL}`}>
            Hari Ini
          </div>
        </div>

        {students.map((student, idx) => {
          const entry = statusMap[student.id] || { status: 'Hadir', late: false };
          return (
            <div key={student.id} className="flex border-t border-gray-100">
              <div className={`sticky left-0 z-10 bg-white px-2 sm:px-3 py-2 font-bold text-sm text-gray-900 truncate ${NAME_COL}`}>
                <span className="text-gray-400 font-normal mr-1 sm:mr-1.5">{idx + 1}.</span>
                {student.name}
              </div>
              {sortedHistory.map((session) => {
                const detail = (session.details || []).find((d) => d.studentId === student.id);
                return (
                  <div key={session.id} className={`flex items-center justify-center py-2 ${HISTORY_COL}`}>
                    <HistoryBadge detail={detail} />
                  </div>
                );
              })}
              <div className={`sticky right-0 z-10 bg-white border-l-2 border-gray-200 px-1.5 sm:px-2.5 py-2 flex items-center ${TODAY_COL}`}>
                <TodayStatusControl value={entry} onChange={(next) => onChange(student.id, next)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
