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
    if (!alreadyWarm) setLoading(true);
    try {
      setSchedules(await fetchSchedules(workspaceId));
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
    if (workspaceId) loadSchedules();
    else setLoading(false);
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

  if (loading) return <LoadingSpinner text="Memuat jadwal..." />;

  return (
    <div className="mx-auto max-w-5xl space-y-5 text-[#242923] sm:space-y-6">
      <section className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-[#D9DED5] bg-[#FFFEF9] p-4 shadow-sm sm:rounded-3xl sm:p-6 md:flex-row md:items-center">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[#2F6B4F]">Buku kerja guru · Perencanaan</p>
          <h1 className="text-xl font-extrabold text-[#242923] sm:text-2xl">Jadwal Mengajar</h1>
          <p className="mt-1 text-sm text-[#5D665E]">Atur pembagian jam mengajar mingguan per kelas</p>
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-3 md:w-auto md:justify-end">
          <div className="flex rounded-xl bg-[#F0EFE8] p-1" aria-label="Pilih sistem hari sekolah">
            <button type="button" onClick={() => setSchoolSystem('5')} aria-pressed={schoolSystem === '5'} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B4F] ${schoolSystem === '5' ? 'bg-[#FFFEF9] text-[#24563F] shadow-sm' : 'text-[#5D665E] hover:text-[#242923]'}`}>5 Hari</button>
            <button type="button" onClick={() => setSchoolSystem('6')} aria-pressed={schoolSystem === '6'} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B4F] ${schoolSystem === '6' ? 'bg-[#FFFEF9] text-[#24563F] shadow-sm' : 'text-[#5D665E] hover:text-[#242923]'}`}>6 Hari</button>
          </div>
          <button type="button" onClick={() => setShowAddModal(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#2F6B4F] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#24563F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B4F] focus-visible:ring-offset-2">
            <Plus className="h-4 w-4" aria-hidden="true" /> Tambah Jadwal
          </button>
        </div>
      </section>
      <ScheduleFormModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} activeDays={activeDays} defaultSubject={defaultSubject} onSubmit={handleAddSchedule} />
      <ScheduleDeleteConfirmModal isOpen={deleteTargetId !== null} onClose={() => setDeleteTargetId(null)} onConfirm={handleConfirmDelete} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        {activeDays.map((d) => <ScheduleDayCard key={d} day={d} items={sortSchedulesChronologically(schedules.filter((s) => s.day === d))} onRequestDelete={setDeleteTargetId} />)}
      </div>
    </div>
  );
}
