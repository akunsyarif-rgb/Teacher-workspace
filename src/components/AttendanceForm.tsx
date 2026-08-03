'use client';

import React, { useState, useEffect } from 'react';
import { BookOpen, UserCheck, Table } from 'lucide-react';
import Card from './ui/Card';
import JournalTab from './journal/JournalTab';
import AttendanceTab from './attendance/AttendanceTab';
import GradesTab from './grades/GradesTab';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as classController from '@/lib/controllers/classController';
import * as scheduleController from '@/lib/controllers/scheduleController';
import { getCurrentDayName } from '@/lib/services/dashboardService';
import { findActiveScheduleId } from '@/lib/utils/scheduleTime';

export default function AttendanceForm() {
  const { workspaceId } = useWorkspace();
  const [activeTab, setActiveTab] = useState<'jurnal' | 'presensi' | 'nilai'>('jurnal');
  const [classesList, setClassesList] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [subject, setSubject] = useState('');
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedSubject = localStorage.getItem('teacher_main_subject');
    setSubject(savedSubject || '');
  }, []);

  useEffect(() => {
    if (workspaceId) {
      loadClasses();
      loadSchedules();
    } else {
      setLoading(false);
    }
  }, [workspaceId]);

  async function loadClasses() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const summaries = await classController.fetchClassSummaries(workspaceId);
      const classNames = summaries.map((s: any) => s.className);
      setClassesList(classNames);
      if (classNames.length > 0 && !selectedClass) {
        setSelectedClass(classNames[0]);
      }
    } catch (error) {
      console.error('Gagal memuat daftar kelas:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadSchedules() {
    if (!workspaceId) return;
    try {
      const list = await scheduleController.fetchSchedules(workspaceId);
      setSchedules(list);
    } catch (error) {
      console.error('Gagal memuat jadwal:', error);
    }
  }

  const activeScheduleId = selectedClass
    ? findActiveScheduleId(schedules, selectedClass, getCurrentDayName())
    : null;

  const tabs = [
    { key: 'jurnal', label: 'Jurnal Mengajar', icon: BookOpen },
    { key: 'presensi', label: 'Presensi', icon: UserCheck },
    { key: 'nilai', label: 'Daftar Nilai', icon: Table },
  ] as const;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-xs font-bold text-gray-500">Memuat data kelas...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card className="space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Pusat Kegiatan Kelas & Penilaian</h2>
            <p className="text-xs text-gray-500">Kelola jurnal, presensi, dan buku nilai dalam satu layar</p>
          </div>
          <div className="flex bg-gray-100 p-1.5 rounded-2xl w-full md:w-auto">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {classesList.length === 0 ? (
            <p className="text-xs text-gray-400">Belum ada data kelas atau siswa di database.</p>
          ) : (
            classesList.map((cls) => (
              <button
                key={cls}
                onClick={() => setSelectedClass(cls)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                  selectedClass === cls ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                Kelas {cls}
              </button>
            ))
          )}
        </div>
      </Card>

      {selectedClass && activeTab === 'jurnal' && (
        <JournalTab className={selectedClass} subject={subject} scheduleId={activeScheduleId} />
      )}
      {selectedClass && activeTab === 'presensi' && (
        <AttendanceTab className={selectedClass} subject={subject} scheduleId={activeScheduleId} />
      )}
      {selectedClass && activeTab === 'nilai' && <GradesTab className={selectedClass} />}
    </div>
  );
}
