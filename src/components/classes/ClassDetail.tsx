'use client';

import React, { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as classController from '@/lib/controllers/classController';
import ConfirmDeleteModal from '@/src/components/ui/ConfirmDeleteModal';

type ClassDetailProps = {
  className: string;
  onBack: () => void;
  backLabel?: string;
};

export default function ClassDetail({ className, onBack, backLabel = 'Kembali ke Daftar Kelas' }: ClassDetailProps) {
  const { workspaceId } = useWorkspace();
  const [students, setStudents] = useState<any[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; nis: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (workspaceId && className) {
      loadStudents();
    }
  }, [workspaceId, className]);

  async function loadStudents() {
    if (!workspaceId || !className) return;
    setLoading(true);
    try {
      const list = await classController.fetchStudentsInClass(workspaceId, className);
      setStudents(list);
    } catch (error) {
      console.error('Gagal memuat siswa:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    await classController.deleteStudent(id);
    await loadStudents();
    setDeleteTarget(null);
  }

  if (loading) {
    return (
      <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-xs font-bold text-gray-500">Memuat data siswa...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-100 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider">Kelas {className}</h3>
          <p className="text-xs font-bold text-gray-400 mt-0.5">Total {students.length} Siswa</p>
        </div>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all"
        >
          {backLabel}
        </button>
      </div>

      {students.length === 0 ? (
        <p className="text-xs font-bold text-gray-400 text-center py-10">Belum ada siswa di kelas ini.</p>
      ) : (
        <div className="space-y-2.5">
          {students.map((student, idx) => (
            <div
              key={student.id}
              className="p-4 bg-gray-50 rounded-2xl flex justify-between items-center border border-gray-100 shadow-sm hover:border-emerald-200 transition-all"
            >
              <div className="flex items-center gap-4">
                <span className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-700 font-extrabold text-xs flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <div>
                  <p className="text-xs font-extrabold text-gray-900">{student.name}</p>
                  <p className="text-[10px] font-bold text-gray-500 mt-0.5">NIS: {student.nis || '-'}</p>
                </div>
              </div>
              <button
                onClick={() => setDeleteTarget({ id: student.id, name: student.name, nis: student.nis || '-' })}
                className="p-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-colors shrink-0"
                title="Hapus Siswa"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget!.id)}
        title="Hapus Siswa?"
        itemName={deleteTarget?.name || ""}
        itemDetail={`Kelas ${className} • NIS: ${deleteTarget?.nis || "-"}`}
        requireTyping={true}
        type="danger"
      />
    </div>
  );
}
