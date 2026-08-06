'use client';

import React, { useEffect, useState } from 'react';
import { ClipboardList, Plus, ChevronRight, Trash2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { SkeletonCard } from '../ui/Skeleton';
import AssignmentFormModal from './AssignmentFormModal';
import SubmissionPanel from './SubmissionPanel';
import * as assignmentController from '@/lib/controllers/assignmentController';
import { useWorkspace } from '@/src/context/WorkspaceContext';

type AssignmentsTabProps = {
  className: string;
  subject: string;
};

export default function AssignmentsTab({ className, subject }: AssignmentsTabProps) {
  const { workspaceId } = useWorkspace();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    if (className && workspaceId) loadAssignments();
  }, [className, workspaceId]);

  async function loadAssignments() {
    if (!workspaceId || !className) return;
    setLoading(true);
    try {
      const list = await assignmentController.fetchAssignments(workspaceId, className);
      setAssignments(list);
    } catch (error) {
      console.error('Gagal memuat tugas:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(data: { title: string; description: string; dueDate: string }) {
    if (!workspaceId) return;
    await assignmentController.createAssignment(workspaceId, className, subject, data);
    await loadAssignments();
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Hapus tugas ini? Nilai yang sudah masuk gradebook tidak ikut terhapus.')) return;
    await assignmentController.removeAssignment(id);
    await loadAssignments();
  }

  if (selected && workspaceId) {
    return (
      <SubmissionPanel
        workspaceId={workspaceId}
        className={className}
        assignment={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-blue-600" />
            Tugas Kelas {className}
          </h3>
          <p className="text-xs text-gray-500">Buat tugas dan nilai pengumpulan siswa</p>
        </div>
        <Button className="w-auto px-4" onClick={() => setShowModal(true)}>
          <Plus className="w-4 h-4" />
          <span>Buat Tugas</span>
        </Button>
      </Card>

      <AssignmentFormModal isOpen={showModal} onClose={() => setShowModal(false)} onSubmit={handleCreate} />

      {loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : assignments.length === 0 ? (
        <Card>
          <p className="text-xs text-gray-400 text-center py-4">
            Belum ada tugas untuk kelas ini. Klik &quot;Buat Tugas&quot; untuk mulai.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {assignments.map((assignment) => (
            <button
              key={assignment.id}
              onClick={() => setSelected(assignment)}
              className="w-full bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between gap-3 text-left hover:border-blue-200 transition-colors"
            >
              <div>
                <p className="text-xs font-bold text-gray-900">{assignment.title}</p>
                <p className="text-[11px] text-gray-500">Tenggat {assignment.dueDate}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  onClick={(e) => handleDelete(assignment.id, e)}
                  className="p-2 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </span>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
