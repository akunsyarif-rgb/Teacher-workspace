'use client';

import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import { fetchSchedules, submitSchedule, deleteScheduleById } from '@/lib/controllers/scheduleController';
import { SCHOOL_DAYS_5, SCHOOL_DAYS_6 } from '@/lib/config/constants';
import ScheduleFormModal from './schedule/ScheduleFormModal';
import ScheduleDayCard from './schedule/ScheduleDayCard';
import ScheduleDeleteConfirmModal from './schedule/ScheduleDeleteConfirmModal';
import LoadingSpinner from './ui/LoadingSpinner';

export default function ScheduleManagement() {
  const { workspaceId } = useWorkspace();
  const [schoolSystem, setSchoolSystem] = useState<'5' | '6'>('5');
  const [schedules, setSchedules] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [defaultSubject, setDefaultSubject] = useState('');
  const [loading, setLoading] = useState(true);

  const activeDays = schoolSystem === '5' ? SCHOOL_DAYS_5 : SCHOOL_DAYS_6;

  async function loadSchedules() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await fetchSchedules(workspaceId);
      setSchedules(data);
    } catch (error) {
      console.error('Gagal memuat jadwal:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const savedSubject = localStorage.getItem('teacher_main_subject');
    if (savedSubject) setDefaultSubject(savedSubject);
  }, []);

  useEffect(() => {
    if (workspaceId) {
      loadSchedules();
    } else {
      setLoading(false);
    }
  }, [workspaceId]);

  async function handleAddSchedule(input: Parameters<typeof submitSchedule>[1]) {
    if (!workspaceId) return;
    await submitSchedule(workspaceId, input);
    await loadSchedules();
  }

  async function handleConfirmDelete() {
    if (!deleteTargetId) return;
    await deleteScheduleById(deleteTargetId);
    await loadSchedules();
  }

  if (loading) {
    return <LoadingSpinner text="Memuat jadwal..." />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Kelola Jadwal Mengajar</h2>
          <p className="text-xs text-gray-500">Atur pembagian jam mengajar mingguan per kelas</p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setSchoolSystem('5')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                schoolSystem === '5' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              5 Hari
            </button>
            <button
              onClick={() => setSchoolSystem('6')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                schoolSystem === '6' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              6 Hari
            </button>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Jadwal</span>
          </button>
        </div>
      </div>

      <ScheduleFormModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        activeDays={activeDays}
        defaultSubject={defaultSubject}
        onSubmit={handleAddSchedule}
      />

      <ScheduleDeleteConfirmModal
        isOpen={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={handleConfirmDelete}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activeDays.map((d) => (
          <ScheduleDayCard
            key={d}
            day={d}
            items={schedules.filter((s) => s.day === d)}
            onRequestDelete={setDeleteTargetId}
          />
        ))}
      </div>
    </div>
  );
}
