'use client';

import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import AddStudentForm from './classes/AddStudentForm';
import BulkImportForm from './classes/BulkImportForm';
import ClassCard from './classes/ClassCard';
import ClassDetail from './classes/ClassDetail';
import Modal from './ui/Modal';
import * as classController from '@/lib/controllers/classController';
import LoadingSpinner from './ui/LoadingSpinner';

export default function ClassManagement() {
  const { workspaceId } = useWorkspace();
  const [view, setView] = useState<'overview' | 'detail'>('overview');
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [classSummaries, setClassSummaries] = useState<{ className: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddClass, setShowAddClass] = useState(false);

  useEffect(() => {
    if (workspaceId) {
      loadSummaries();
    } else {
      setLoading(false);
    }
  }, [workspaceId]);

  async function loadSummaries() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const summaries = await classController.fetchClassSummaries(workspaceId);
      setClassSummaries(summaries);
    } catch (error) {
      console.error('Gagal memuat daftar kelas:', error);
    } finally {
      setLoading(false);
    }
  }

  function openDetail(className: string) {
    setActiveClass(className);
    setView('detail');
  }

  function backToOverview() {
    setActiveClass(null);
    setView('overview');
    loadSummaries();
  }

  if (loading) {
    return <LoadingSpinner text="Memuat daftar kelas..." />;
  }

  if (view === 'detail' && activeClass) {
    return <ClassDetail className={activeClass} onBack={backToOverview} />;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 px-1">
          <h3 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">
            Daftar Kelas Terdaftar ({classSummaries.length})
          </h3>
          <button
            onClick={() => setShowAddClass(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Tambah Kelas Baru
          </button>
        </div>

        {classSummaries.length === 0 ? (
          <div className="bg-white p-10 rounded-3xl text-center border border-gray-100 shadow-sm">
            <p className="text-xs font-bold text-gray-400">Belum ada kelas atau data siswa yang diinput.</p>
            <p className="text-[10px] text-gray-400 mt-1">Buat kelas baru lewat tombol di atas.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {classSummaries.map((summary) => (
              <ClassCard
                key={summary.className}
                className={summary.className}
                count={summary.count}
                onClick={() => openDetail(summary.className)}
              />
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={showAddClass} onClose={() => setShowAddClass(false)} title="Tambah Kelas Baru">
        <div className="space-y-6">
          <AddStudentForm
            onAdded={() => {
              setShowAddClass(false);
              loadSummaries();
            }}
          />
          <BulkImportForm
            onAdded={() => {
              setShowAddClass(false);
              loadSummaries();
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
