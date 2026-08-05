'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import Badge from '../ui/Badge';

type GradesTableProps = {
  students: { id: string; name: string; nis?: string }[];
  columns: { id: string; title: string; type: string }[];
  grades: Record<string, Record<string, string>>;
  onScoreChange: (studentId: string, columnId: string, value: string) => void;
  onDeleteColumn: (columnId: string) => void;
};

export default function GradesTable({ students, columns, grades, onScoreChange, onDeleteColumn }: GradesTableProps) {
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
                      className="p-1 text-red-400 hover:text-red-600 rounded"
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
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="-"
                    value={grades[student.id]?.[col.id] ?? ''}
                    onChange={(e) => onScoreChange(student.id, col.id, e.target.value)}
                    className="w-16 p-2 text-center bg-gray-50 border border-gray-200 rounded-xl font-bold text-sm text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
                  />
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
