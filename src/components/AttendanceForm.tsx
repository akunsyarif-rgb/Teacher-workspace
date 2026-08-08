'use client';

import React, { useState, useEffect } from 'react';
import { BookOpen, UserCheck, Table, History, CheckCircle2, Circle, PartyPopper, ClipboardList, Megaphone } from 'lucide-react';
import Link from 'next/link';
import Card from './ui/Card';
import ClassSelector from './attendance/ClassSelector';
import JournalTab from './journal/JournalTab';
import AttendanceTab from './attendance/AttendanceTab';
import GradesTab from './grades/GradesTab';
import AssignmentsTab from './assignments/AssignmentsTab';
import AnnouncementsTab from './announcements/AnnouncementsTab';
import TimelineTab from './timeline/TimelineTab';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as classController from '@/lib/controllers/classController';
import * as scheduleController from '@/lib/controllers/scheduleController';
import * as dashboardController from '@/lib/controllers/dashboardController';
import { getCurrentDayName, TodayClassStatus } from '@/lib/services/dashboardService';
import { findActiveScheduleId, resolveCurrentWorkflowStep } from '@/lib/utils/scheduleTime';

export default function AttendanceForm() {
  const { workspaceId } = useWorkspace();
  const [activeTab, setActiveTab] = useState<'jurnal' | 'presensi' | 'nilai' | 'tugas' | 'pengumuman' | 'riwayat'>('jurnal');
  const [classesList, setClassesList] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [subject, setSubject] = useState('');
  const [schedules, setSchedules] = useState<any[]>([]);
  const [todayClassStatuses, setTodayClassStatuses] = useState<TodayClassStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedSubject = localStorage.getItem('teacher_main_subject');
    setSubject(savedSubject || '');
  }, []);

  // Dukung deep-link dari Action Center di Dashboard (?class=XI+A&tab=presensi)
  // supaya guru langsung diarahkan ke tugas yang tepat, bukan harus pilih ulang.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const cls = params.get('class');
    const tab = params.get('tab');
    if (cls) setSelectedClass(cls);
    if (
      tab === 'jurnal' ||
      tab === 'presensi' ||
      tab === 'nilai' ||
      tab === 'tugas' ||
      tab === 'pengumuman' ||
      tab === 'riwayat'
    ) {
      setActiveTab(tab);
    }
  }, []);

  // Muat kelas, jadwal, dan status sesi bersamaan — Workflow Engine perlu
  // ketiganya sekaligus untuk memilihkan kelas default yang paling relevan
  // (sesi yang sedang berlangsung), bukan sekadar kelas pertama di daftar.
  useEffect(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const [summaries, scheduleList, statuses] = await Promise.all([
        classController.fetchClassSummaries(workspaceId).catch((error) => {
          console.error('Gagal memuat daftar kelas:', error);
          return [];
        }),
        scheduleController.fetchSchedules(workspaceId).catch((error) => {
          console.error('Gagal memuat jadwal:', error);
          return [];
        }),
        loadSessionStatuses(),
      ]);
      const classNames = summaries.map((s: any) => s.className);
      setClassesList(classNames);
      setSchedules(scheduleList);
      if (classNames.length > 0 && !selectedClass) {
        const step = resolveCurrentWorkflowStep(statuses);
        setSelectedClass(step && classNames.includes(step.status.className) ? step.status.className : classNames[0]);
      }
      setLoading(false);
    })();
  }, [workspaceId]);

  async function loadSessionStatuses() {
    if (!workspaceId) return [];
    try {
      const summary = await dashboardController.fetchDashboardSummary(workspaceId);
      const statuses = summary.todayClassStatuses || [];
      setTodayClassStatuses(statuses);
      return statuses;
    } catch (error) {
      console.error('Gagal memuat status sesi mengajar:', error);
      return [];
    }
  }

  const activeScheduleId = selectedClass
    ? findActiveScheduleId(schedules, selectedClass, getCurrentDayName())
    : null;

  const currentSession = todayClassStatuses.find((s) => s.scheduleId === activeScheduleId) ?? null;

  // Setelah presensi/jurnal tersimpan, refresh status sesi dan otomatis
  // pindah ke langkah berikutnya kalau sesi ini punya jadwal hari ini —
  // supaya guru tidak perlu klik-klik menu sendiri (lihat diskusi
  // "Class Workspace" & "Workflow Engine" di roadmap).
  async function handleAttendanceSubmitted() {
    const statuses = await loadSessionStatuses();
    const updated = statuses.find((s) => s.scheduleId === activeScheduleId);
    if (updated && !updated.hasJournal) {
      setActiveTab('jurnal');
    }
  }

  async function handleJournalSubmitted() {
    await loadSessionStatuses();
  }

  const tabs = [
    { key: 'jurnal', label: 'Jurnal Mengajar', icon: BookOpen },
    { key: 'presensi', label: 'Presensi', icon: UserCheck },
    { key: 'nilai', label: 'Nilai', icon: Table },
    { key: 'tugas', label: 'Tugas', icon: ClipboardList },
    { key: 'pengumuman', label: 'Pengumuman', icon: Megaphone },
    { key: 'riwayat', label: 'Riwayat', icon: History },
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
        <div>
          <h2 className="text-lg font-bold text-gray-900">Pusat Kegiatan Kelas & Penilaian</h2>
          <p className="text-xs text-gray-500">Kelola jurnal, presensi, nilai, dan riwayat dalam satu layar</p>
        </div>

        {/* Baris tab di-scroll horizontal (bukan disempitkan/disingkat)
            supaya label tetap terbaca penuh walau ada 6 tab di layar HP. */}
        <div className="flex gap-1.5 bg-gray-100 p-1.5 rounded-2xl overflow-x-auto no-scrollbar">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              title={label}
              className={`shrink-0 flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 ${
                activeTab === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="pt-2 border-t border-gray-100">
          {classesList.length === 0 ? (
            <p className="text-xs text-gray-400">Belum ada data kelas atau siswa di database.</p>
          ) : (
            <ClassSelector classes={classesList} selected={selectedClass} onChange={setSelectedClass} />
          )}
        </div>
      </Card>

      {currentSession && (
        <div
          className={`p-4 md:p-5 rounded-2xl md:rounded-3xl border space-y-3 ${
            currentSession.isDone
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-blue-50 border-blue-200'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Sesi Mengajar</p>
              <p className="text-sm font-extrabold text-gray-900">
                Kelas {currentSession.className} • {currentSession.timeSlot}
                {currentSession.subject ? ` • ${currentSession.subject}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-1.5 text-xs font-bold ${currentSession.hasAttendance ? 'text-emerald-700' : 'text-gray-400'}`}>
                {currentSession.hasAttendance ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                Presensi
              </span>
              <span className={`flex items-center gap-1.5 text-xs font-bold ${currentSession.hasJournal ? 'text-emerald-700' : 'text-gray-400'}`}>
                {currentSession.hasJournal ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                Jurnal
              </span>
            </div>
          </div>

          {currentSession.isDone && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-emerald-200">
              <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                <PartyPopper className="w-4 h-4" />
                Sesi ini sudah selesai — kerja bagus!
              </p>
              <Link href="/" className="text-xs font-bold text-blue-600 hover:underline">
                Kembali ke Beranda →
              </Link>
            </div>
          )}
        </div>
      )}

      {selectedClass && activeTab === 'jurnal' && (
        <JournalTab
          className={selectedClass}
          subject={subject}
          scheduleId={activeScheduleId}
          onSubmitted={handleJournalSubmitted}
        />
      )}
      {selectedClass && activeTab === 'presensi' && (
        <AttendanceTab
          className={selectedClass}
          subject={subject}
          scheduleId={activeScheduleId}
          onSubmitted={handleAttendanceSubmitted}
        />
      )}
      {selectedClass && activeTab === 'nilai' && <GradesTab className={selectedClass} />}
      {selectedClass && activeTab === 'tugas' && <AssignmentsTab className={selectedClass} subject={subject} />}
      {selectedClass && activeTab === 'pengumuman' && (
        <AnnouncementsTab className={selectedClass} subject={subject} />
      )}
      {selectedClass && activeTab === 'riwayat' && <TimelineTab className={selectedClass} />}
    </div>
  );
}
