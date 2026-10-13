'use client';

import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import { fetchSchedules, submitSchedule, deleteScheduleById, schedulesCacheKey } from '@/lib/controllers/scheduleController';
import { getCached } from '@/lib/utils/sessionCache';
import { sortSchedulesChronologically } from '@/lib/utils/scheduleTime';
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
    const alreadyWarm = getCached(schedulesCacheKey(workspaceId)) !== undefined;
    if (!alreadyWarm) {
      setLoading(true);
    }
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
    <div className="mx-auto max-w-5xl space-y-6 text-[#242923]">
      <div className="bg-[#FFFEF9] p-5 md:p-6 rounded-3xl border border-[#D9DED5] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Kelola Jadwal Mengajar</h2>
          <p className="text-xs text-gray-500">Atur pembagian jam mengajar mingguan per kelas</p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setSchoolSystem('5')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                schoolSystem === '5' ? 'bg-[#FFFEF9] text-[#2F6B4F] shadow-sm' : 'text-[#5D665E]'
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
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#2F6B4F] hover:bg-[#24563F] text-white rounded-xl text-sm font-bold transition-colors shadow-sm shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2F6B4F]"
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
            items={sortSchedulesChronologically(schedules.filter((s) => s.day === d))}
            onRequestDelete={setDeleteTargetId}
          />
        ))}
      </div>
    </div>
  );
}
