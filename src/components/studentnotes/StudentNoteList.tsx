'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Textarea from '../ui/Textarea';
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal';
import InlineAlert from '../ui/InlineAlert';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as classController from '@/lib/controllers/classController';
import * as studentNoteController from '@/lib/controllers/studentNoteController';
import { SkeletonCard } from '../ui/Skeleton';

type StudentNoteListProps = {
  category: string;
  titleLabel: string;
  titlePlaceholder: string;
  emptyMessage: string;
  successMessage: string;
};

// Komponen bersama untuk Konseling, Prestasi, dan Komunikasi Orang Tua —
// bentuk datanya sama persis (siswa + judul/topik + tanggal + keterangan),
// dibedakan lewat field `category` di collection student_notes yang sama.
export default function StudentNoteList({
  category,
  titleLabel,
  titlePlaceholder,
  emptyMessage,
  successMessage,
}: StudentNoteListProps) {
  const { workspaceId, teacherProfile } = useWorkspace();
  const className = teacherProfile?.homeroomClassName || '';

  const [students, setStudents] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [studentId, setStudentId] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (workspaceId && className) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [workspaceId, className]);

  async function loadData() {
    if (!workspaceId || !className) return;
    setLoading(true);
    try {
      const [studentList, noteList] = await Promise.all([
        classController.fetchStudentsInClass(workspaceId, className),
        studentNoteController.fetchStudentNotes(workspaceId, className, category),
      ]);
      setStudents(studentList);
      setNotes(noteList);
      if (studentList.length > 0 && !studentId) {
        setStudentId(studentList[0].id);
      }
    } catch (error) {
      console.error('Gagal memuat catatan siswa:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !className) return;
    const student = students.find((s) => s.id === studentId);
    if (!student) return;
    setSubmitting(true);
    setSuccess(false);
    setErrorMsg('');
    try {
      await studentNoteController.submitStudentNote(workspaceId, className, category, {
        studentId: student.id,
        studentName: student.name,
        title,
        notes: detail,
      });
      setTitle('');
      setDetail('');
      setSuccess(true);
      await loadData();
    } catch (error: any) {
      setErrorMsg(error.message || 'Gagal menyimpan catatan.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await studentNoteController.deleteStudentNote(deleteTarget.id);
    await loadData();
    setDeleteTarget(null);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InlineAlert message={errorMsg} onDismiss={() => setErrorMsg('')} />
      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <Card className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Tambah Catatan</h3>
        {students.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">Belum ada siswa di kelas ini.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">Siswa</label>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                required
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">{titleLabel}</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={titlePlaceholder}
                required
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <Textarea label="Keterangan (Opsional)" value={detail} onChange={setDetail} placeholder="Catatan tambahan..." />
            <Button type="submit" loading={submitting}>
              <Plus className="w-4 h-4" />
              <span>{submitting ? 'Menyimpan...' : 'Simpan Catatan'}</span>
            </Button>
          </form>
        )}
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Riwayat Catatan ({notes.length})</h3>
        {notes.length === 0 ? (
          <p className="text-xs text-gray-400 py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            {emptyMessage}
          </p>
        ) : (
          <div className="space-y-2.5">
            {notes.map((n) => (
              <div
                key={n.id}
                className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                      {n.date}
                    </span>
                    <span className="text-xs font-bold text-gray-900">{n.studentName}</span>
                  </div>
                  <p className="text-xs font-extrabold text-gray-800">{n.title}</p>
                  {n.notes && <p className="text-[11px] text-gray-500">{n.notes}</p>}
                </div>
                <button
                  onClick={() => setDeleteTarget({ id: n.id, title: n.title })}
                  className="p-3.5 text-red-500 hover:bg-red-50 rounded-xl transition-colors active:scale-90 shrink-0"
                  title="Hapus Catatan"
                  aria-label="Hapus Catatan"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Hapus Catatan?"
        itemName={deleteTarget?.title || ''}
        itemDetail={`Kelas ${className}`}
        requireTyping={false}
        type="danger"
      />
    </div>
  );
}
