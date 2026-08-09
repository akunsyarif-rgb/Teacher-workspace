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

// Lebar kolom tetap untuk tampilan spreadsheet (tablet/laptop, md+).
const NAME_COL = 'w-[200px] shrink-0';
const HISTORY_COL = 'w-[40px] shrink-0';
const TODAY_COL = 'w-[300px] shrink-0';

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

// Dua layout terpisah, bukan satu layout yang dipaksa sama di semua
// ukuran layar:
//
// - Mobile (<768px, md:hidden): kartu per siswa — nama, lalu strip
//   riwayat, lalu status hari ini, ditumpuk vertikal. Tidak ada sticky
//   sama sekali; paling nyaman ditekan satu tangan.
//
// - Tablet/laptop (>=768px, hidden md:block): spreadsheet padat —
//   nama, riwayat, dan hari ini sejajar dalam satu baris per siswa,
//   supaya banyak siswa & sesi kelihatan sekaligus (layar cukup lebar
//   untuk itu). HANYA kolom Nama yang sticky (freeze kolom pertama,
//   pola spreadsheet standar). Kolom "Hari Ini" SENGAJA tidak dibuat
//   sticky di sisi kanan seperti desain lama — itu sudah terbukti
//   (lewat pengukuran DOM, bukan dugaan) SELALU menumpuk begitu total
//   lebar kolom melebihi lebar viewport, di ukuran layar manapun,
//   karena sticky kiri & kanan sama-sama menempel ke tepi viewport
//   yang sedang terlihat tanpa saling menyisakan ruang. Kelas dengan
//   sedikit sesi kebetulan belum memicu itu di iPad, tapi begitu
//   sesinya menumpuk sepanjang semester, bug yang sama pasti muncul
//   lagi kalau kolom kanan tetap dipaksa sticky. Tanpa sticky di
//   kanan, kolom ini hanya ikut discroll bersama riwayat — perilaku
//   spreadsheet yang wajar, dan tidak mungkin tumpang tindih.
export default function AttendanceGrid({ students, history, statusMap, onChange }: AttendanceGridProps) {
  const sortedHistory = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return (
    <>
      {/* Mobile: kartu per siswa */}
      <div className="md:hidden space-y-2.5">
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

      {/* Tablet/laptop: spreadsheet, nama di-freeze */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-gray-100 text-xs">
        <div className="w-fit min-w-full">
          <div className="flex bg-gray-50">
            <div className={`sticky left-0 z-20 bg-gray-50 text-left px-3 py-2.5 font-bold text-gray-500 ${NAME_COL}`}>
              Nama Siswa
            </div>
            {sortedHistory.map((session, i) => (
              <div
                key={session.id}
                className={`px-1 py-2.5 text-center font-bold text-gray-400 ${HISTORY_COL}`}
                title={session.date}
              >
                <div>{i + 1}</div>
                <div className="text-[9px] font-medium text-gray-300">{formatShortDate(session.date)}</div>
              </div>
            ))}
            <div className={`border-l-2 border-gray-200 px-3 py-2.5 text-center font-bold text-gray-500 ${TODAY_COL}`}>
              Hari Ini
            </div>
          </div>

          {students.map((student, idx) => {
            const entry = statusMap[student.id] || { status: 'Hadir', late: false };
            return (
              <div key={student.id} className="flex border-t border-gray-100">
                <div className={`sticky left-0 z-10 bg-white px-3 py-2.5 font-bold text-sm text-gray-900 ${NAME_COL}`}>
                  <span className="text-gray-400 font-normal mr-1.5">{idx + 1}.</span>
                  {student.name}
                </div>
                {sortedHistory.map((session) => {
                  const detail = (session.details || []).find((d) => d.studentId === student.id);
                  return (
                    <div key={session.id} className={`flex items-center justify-center py-2.5 ${HISTORY_COL}`}>
                      <HistoryBadge detail={detail} date={session.date} />
                    </div>
                  );
                })}
                <div className={`border-l-2 border-gray-200 px-3 py-2.5 flex items-center ${TODAY_COL}`}>
                  <TodayStatusControl value={entry} onChange={(next) => onChange(student.id, next)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
