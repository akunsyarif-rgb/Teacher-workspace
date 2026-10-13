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
  onEditColumn: (columnId: string) => void;
  onDeleteColumn: (columnId: string) => void;
};

export function cellKey(studentId: string, columnId: string) {
  return `${studentId}_${columnId}`;
}

function calculateAverage(studentGrades: Record<string, string> | undefined, columns: { id: string }[]) {
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

function GradeCell({
  studentId,
  studentName,
  col,
  savedValue,
  currentValue,
  isLocked,
  onScoreChange,
  onRequestUnlock,
}: {
  studentId: string;
  studentName: string;
  col: { id: string; title: string };
  savedValue: string;
  currentValue: string;
  isLocked: boolean;
  onScoreChange: (studentId: string, columnId: string, value: string) => void;
  onRequestUnlock: (studentId: string, columnId: string) => void;
}) {
  const isDraft = !isLocked && currentValue.trim() !== '';

  if (isLocked) {
    return (
      <div className="relative inline-flex items-center justify-center">
        <span className="flex h-9 w-16 items-center justify-center gap-1 rounded-xl border border-[#B6C8B8] bg-[#EDF3E8] text-sm font-bold text-[#24563F]">
          <Lock className="w-2.5 h-2.5 shrink-0" />
          {savedValue}
        </span>
        <button
          type="button"
          onClick={() => onRequestUnlock(studentId, col.id)}
          className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-[#D9DED5] bg-[#FFFEF9] shadow-sm transition-colors hover:bg-[#F7F5EF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B4F]"
          title="Edit nilai"
          aria-label={`Edit nilai ${studentName} - ${col.title}`}
        >
          <Pencil className="w-2.5 h-2.5 text-[#5D665E]" />
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
        className={`w-16 p-2 text-center border rounded-xl font-bold text-sm text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-[#2F6B4F] ${
          isDraft ? 'bg-amber-50 border-amber-300' : 'bg-[#F7F5EF] border-[#D9DED5]'
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

type GradesRowProps = {
  idx: number;
  student: { id: string; name: string; nis?: string };
  columns: { id: string; title: string; type: string }[];
  studentGrades: Record<string, string> | undefined;
  studentSavedGrades: Record<string, string> | undefined;
  unlockedCells: Set<string>;
  onScoreChange: (studentId: string, columnId: string, value: string) => void;
  onRequestUnlock: (studentId: string, columnId: string) => void;
};

// Baris per siswa dipisah & di-memo sendiri: mengetik nilai satu siswa
// hanya mengubah grades[studentId] itu sendiri (lihat handleScoreChange di
// GradesTab.tsx, updatenya immutable per-studentId) — objek grades milik
// siswa LAIN tetap sama reference-nya, jadi baris mereka tidak perlu
// dirender ulang sama sekali. Tanpa ini, mengetik satu nilai me-render
// ulang seluruh tabel (bisa puluhan baris x beberapa kolom) di setiap
// ketukan tombol.
const GradesRow = React.memo(function GradesRow({
  idx,
  student,
  columns,
  studentGrades,
  studentSavedGrades,
  unlockedCells,
  onScoreChange,
  onRequestUnlock,
}: GradesRowProps) {
  return (
    <tr className="transition-colors hover:bg-[#F7F5EF]/70">
      <td className="p-4 text-center text-nb-ink-muted font-bold">{idx + 1}</td>
      <td className="sticky left-0 z-10 bg-[#FFFEF9] p-4 font-bold text-[#242923]">
        <p className="text-sm">{student.name}</p>
        <p className="text-xs text-[#687168] font-normal">NIS: {student.nis || '-'}</p>
      </td>
      {columns.map((col) => {
        const savedValue = studentSavedGrades?.[col.id] ?? '';
        const currentValue = studentGrades?.[col.id] ?? '';
        const isLocked = savedValue !== '' && !unlockedCells.has(cellKey(student.id, col.id));
        return (
          <td key={col.id} className="p-3 text-center">
            <GradeCell
              studentId={student.id}
              studentName={student.name}
              col={col}
              savedValue={savedValue}
              currentValue={currentValue}
              isLocked={isLocked}
              onScoreChange={onScoreChange}
              onRequestUnlock={onRequestUnlock}
            />
          </td>
        );
      })}
      <td className="p-4 text-center text-sm font-extrabold text-[#24563F] bg-[#EDF3E8] md:sticky md:right-0 md:z-10 md:border-l md:border-nb-rule">
        {calculateAverage(studentGrades, columns)}
      </td>
    </tr>
  );
});

function GradesTable({
  students,
  columns,
  grades,
  savedGrades,
  unlockedCells,
  onScoreChange,
  onRequestUnlock,
  onEditColumn,
  onDeleteColumn,
}: GradesTableProps) {
  if (students.length === 0) {
    return <div className="text-center py-12 text-xs text-nb-ink-muted">Belum ada siswa terdaftar di kelas ini.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#D9DED5] bg-[#F7F5EF] text-xs font-bold uppercase tracking-wider text-[#5D665E]">
            <th className="p-4 w-12 text-center">No</th>
            <th className="sticky left-0 z-10 min-w-[200px] bg-[#F7F5EF] p-4">Nama Siswa</th>
            {columns.map((col) => (
              <th key={col.id} className="p-4 min-w-[130px] text-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[#242923] font-bold truncate max-w-[110px]" title={col.title}>
                    {col.title}
                  </span>
                  <div className="flex items-center gap-1">
                    <Badge label={col.type} />
                    <button
                      onClick={() => onEditColumn(col.id)}
                      className="p-2 -m-1 text-nb-ink-muted hover:text-[#2F6B4F] rounded active:scale-90 transition-transform"
                      title="Edit Nama Kolom"
                      aria-label={`Edit Nama Kolom ${col.title}`}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
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
            <th className="min-w-[100px] bg-[#EDF3E8] p-4 text-center font-extrabold text-[#24563F] md:sticky md:right-0 md:z-10 md:border-l md:border-nb-rule">RATA-RATA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#D9DED5] bg-[#FFFEF9] text-sm">
          {students.map((student, idx) => (
            <GradesRow
              key={student.id}
              idx={idx}
              student={student}
              columns={columns}
              studentGrades={grades[student.id]}
              studentSavedGrades={savedGrades[student.id]}
              unlockedCells={unlockedCells}
              onScoreChange={onScoreChange}
              onRequestUnlock={onRequestUnlock}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default React.memo(GradesTable);
