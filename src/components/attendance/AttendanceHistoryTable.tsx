'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, History as HistoryIcon } from 'lucide-react';
import { ATTENDANCE_STATUS_OPTIONS } from '@/lib/config/constants';
import { STATUS_LETTER, STATUS_COLOR } from '@/lib/utils/attendanceStatus';

type AttendanceSession = {
  id: string;
  date: string;
  details?: { studentId: string; status: string }[];
};

type StudentLike = { id: string; name: string; nis?: string };

type AttendanceHistoryTableProps = {
  students: StudentLike[];
  history: AttendanceSession[];
  statusMap: Record<string, string>;
  onStatusChange: (studentId: string, status: string) => void;
};

const ACTIVE_COLOR: Record<string, string> = {
  Hadir: 'bg-blue-600 text-white shadow-sm',
  Terlambat: 'bg-orange-500 text-white shadow-sm',
  Sakit: 'bg-amber-500 text-white shadow-sm',
  Izin: 'bg-purple-600 text-white shadow-sm',
  Dispensasi: 'bg-teal-600 text-white shadow-sm',
  Alpa: 'bg-red-600 text-white shadow-sm',
};

const NO_COL_WIDTH = 32;
const MOBILE_RECENT_COUNT = 5;

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export default function AttendanceHistoryTable({
  students,
  history,
  statusMap,
  onStatusChange,
}: AttendanceHistoryTableProps) {
  const [showHistoryMobile, setShowHistoryMobile] = useState(false);

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [history]
  );

  return (
    <div className="space-y-2">
      {sortedHistory.length > 0 && (
        <button
          type="button"
          onClick={() => setShowHistoryMobile((v) => !v)}
          className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-[11px] font-bold w-fit"
        >
          <HistoryIcon className="w-3.5 h-3.5" />
          {showHistoryMobile ? 'Sembunyikan Riwayat' : `Tampilkan Riwayat (${MOBILE_RECENT_COUNT} Terakhir)`}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showHistoryMobile ? 'rotate-180' : ''}`} />
        </button>
      )}

      {/* Keterangan status */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-gray-500">
        {ATTENDANCE_STATUS_OPTIONS.map((opt) => (
          <span key={opt} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded flex items-center justify-center text-white text-[8px] font-extrabold ${STATUS_COLOR[opt]}`}>
              {STATUS_LETTER[opt]}
            </span>
            {opt}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100">
        <table className="border-separate border-spacing-0 text-xs w-full">
          <thead>
            <tr className="bg-gray-50">
              <th
                className="sticky z-20 bg-gray-50 border-b border-gray-100 px-2 py-2 text-left text-[10px] font-bold text-gray-500"
                style={{ left: 0, width: NO_COL_WIDTH }}
              >
                No
              </th>
              <th
                className="sticky z-20 bg-gray-50 border-b border-r border-gray-100 px-2 py-2 text-left text-[10px] font-bold text-gray-500"
                style={{ left: NO_COL_WIDTH }}
              >
                Nama Siswa
              </th>
              {sortedHistory.map((session, idx) => {
                const isRecent = idx >= sortedHistory.length - MOBILE_RECENT_COUNT;
                const mobileVisible = showHistoryMobile && isRecent;
                return (
                  <th
                    key={session.id}
                    className={`${mobileVisible ? 'table-cell' : 'hidden'} md:table-cell border-b border-gray-100 px-1.5 py-2 text-center text-[9px] font-bold text-gray-400`}
                    title={session.date}
                  >
                    <div className="flex flex-col items-center leading-tight">
                      <span>{idx + 1}</span>
                      <span className="font-normal">{formatShortDate(session.date)}</span>
                    </div>
                  </th>
                );
              })}
              <th
                className="sticky z-20 bg-gray-50 border-b border-l border-gray-100 px-2 py-2 text-left text-[10px] font-bold text-gray-500"
                style={{ right: 0 }}
              >
                Hari Ini
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((student, index) => (
              <tr key={student.id}>
                <td
                  className="sticky z-10 bg-white border-b border-gray-100 px-2 py-2 align-top"
                  style={{ left: 0, width: NO_COL_WIDTH }}
                >
                  <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 font-bold text-[10px] flex items-center justify-center">
                    {index + 1}
                  </span>
                </td>
                <td
                  className="sticky z-10 bg-white border-b border-r border-gray-100 px-2 py-2 align-top"
                  style={{ left: NO_COL_WIDTH }}
                >
                  <div className={showHistoryMobile ? 'max-w-[72px] md:max-w-none' : 'max-w-none'}>
                    <p className="text-xs font-bold text-gray-900 truncate">{student.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">NIS: {student.nis || '-'}</p>
                  </div>
                </td>
                {sortedHistory.map((session, idx) => {
                  const isRecent = idx >= sortedHistory.length - MOBILE_RECENT_COUNT;
                  const mobileVisible = showHistoryMobile && isRecent;
                  const detail = (session.details || []).find((d) => d.studentId === student.id);
                  return (
                    <td
                      key={session.id}
                      className={`${mobileVisible ? 'table-cell' : 'hidden'} md:table-cell border-b border-gray-100 px-1.5 py-2 text-center align-top`}
                    >
                      <span
                        className={`inline-flex w-5 h-5 rounded items-center justify-center text-[9px] font-extrabold leading-none ${
                          detail ? `${STATUS_COLOR[detail.status] || 'bg-gray-400'} text-white` : 'bg-gray-50 text-gray-300 border border-gray-200'
                        }`}
                        title={detail ? `${session.date}: ${detail.status}` : 'Belum ada data'}
                      >
                        {detail ? STATUS_LETTER[detail.status] || '?' : '·'}
                      </span>
                    </td>
                  );
                })}
                <td
                  className="sticky z-10 bg-white border-b border-l border-gray-100 px-2 py-2 align-top"
                  style={{ right: 0, width: 168 }}
                >
                  <div className="flex flex-wrap gap-1">
                    {ATTENDANCE_STATUS_OPTIONS.map((option) => {
                      const isActive = (statusMap[student.id] || 'Hadir') === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => onStatusChange(student.id, option)}
                          className={`px-1.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                            isActive ? ACTIVE_COLOR[option] : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
