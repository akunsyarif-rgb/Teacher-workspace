'use client';

import React from 'react';
import { Trash2, Pencil, Lock } from 'lucide-react';
import Badge from '../ui/Badge';

type GradesTableProps = {
  students: { id: string; name: string; nis?: string }[];
  columns: { id: string; title: string; type: string }[];
  grades: Record<string, Record<string, string>>;
  savedGrades: Record<string, Record<string, string>>;
  unlockedCells: Set<string>;
  onScoreChange: (studentId: string, columnId: string, value: string) => void;
  onRequestUnlock: (studentId: string, columnId: string) => void;
  onDeleteColumn: (columnId: string) => void;
};

export function cellKey(studentId: string, columnId: string) {
  return `${studentId}_${columnId}`;
}

export default function GradesTable({
  students,
  columns,
  grades,
  savedGrades,
  unlockedCells,
  onScoreChange,
  onRequestUnlock,
  onDeleteColumn,
}: GradesTableProps) {
  function calculateAverage(studentId: string) {
    const studentGrades = grades[studentId];
    if (!studentGrades || columns.length === 0) return '-';

    let total = 0;
    let count = 0;
    columns.forEach((col) => {
      const val = studentGrades[col.id];
      if (val !== undefined && val !== '' && !isNaN(Number(val))) {
        total += Number(val);
        count += 1;
      }
    });

    return count > 0 ? (total / count).toFixed(1) : '-';
  }

  if (students.length === 0) {
    return <div className="text-center py-12 text-xs text-gray-400">Belum ada siswa terdaftar di kelas ini.</div>;
  }

  function renderCell(studentId: string, studentName: string, col: { id: string; title: string }) {
    const key = cellKey(studentId, col.id);
    const savedValue = savedGrades[studentId]?.[col.id] ?? '';
    const currentValue = grades[studentId]?.[col.id] ?? '';
    const isLocked = savedValue !== '' && !unlockedCells.has(key);
    const isDraft = !isLocked && currentValue.trim() !== '';

    if (isLocked) {
      return (
        <div className="relative inline-flex items-center justify-center">
          <span className="w-16 h-9 flex items-center justify-center gap-1 bg-emerald-50 border border-emerald-200 rounded-xl font-bold text-sm text-emerald-700">
            <Lock className="w-2.5 h-2.5 shrink-0" />
            {savedValue}
          </span>
          <button
            type="button"
            onClick={() => onRequestUnlock(studentId, col.id)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 transition-colors active:scale-90"
            title="Edit nilai"
            aria-label={`Edit nilai ${studentName} - ${col.title}`}
          >
            <Pencil className="w-2.5 h-2.5 text-gray-500" />
          </button>
        </div>
      );
    }

    return (
      <div className="relative inline-flex items-center justify-center">
        <input
          type="number"
          min="0"
          max="100"
          placeholder="-"
          value={currentValue}
          onChange={(e) => onScoreChange(studentId, col.id, e.target.value)}
          aria-label={`Nilai ${studentName} - ${col.title}`}
          className={`w-16 p-2 text-center border rounded-xl font-bold text-sm text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600 ${
            isDraft ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'
          }`}
        />
        {isDraft && (
          <span
            className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border border-white"
            title="Draft — belum disimpan"
          />
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
            <th className="p-4 w-12 text-center">No</th>
            <th className="p-4 min-w-[200px] sticky left-0 bg-gray-50 z-10">Nama Siswa</th>
            {columns.map((col) => (
              <th key={col.id} className="p-4 min-w-[130px] text-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-gray-900 font-bold truncate max-w-[110px]" title={col.title}>
                    {col.title}
                  </span>
                  <div className="flex items-center gap-1">
                    <Badge label={col.type} />
                    <button
                      onClick={() => onDeleteColumn(col.id)}
                      className="p-2 -m-1 text-red-400 hover:text-red-600 rounded active:scale-90 transition-transform"
                      title="Hapus Kolom"
                      aria-label={`Hapus Kolom ${col.title}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </th>
            ))}
            <th className="p-4 min-w-[100px] text-center bg-blue-50/50 text-blue-700 font-extrabold">RATA-RATA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-xs">
          {students.map((student, idx) => (
            <tr key={student.id} className="hover:bg-gray-50/50 transition-colors">
              <td className="p-4 text-center text-gray-400 font-bold">{idx + 1}</td>
              <td className="p-4 font-bold text-gray-900 sticky left-0 bg-white z-10">
                <p className="text-sm">{student.name}</p>
                <p className="text-[10px] text-gray-400 font-normal">NIS: {student.nis || '-'}</p>
              </td>
              {columns.map((col) => (
                <td key={col.id} className="p-3 text-center">
                  {renderCell(student.id, student.name, col)}
                </td>
              ))}
              <td className="p-4 text-center text-sm font-extrabold text-blue-600 bg-blue-50/30">
                {calculateAverage(student.id)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
