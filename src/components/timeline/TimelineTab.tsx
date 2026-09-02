'use client';

import React, { useState, useEffect } from 'react';
import { Clock, BookOpen, UserCheck, History } from 'lucide-react';
import Card from '../ui/Card';
import { SkeletonText, SkeletonCard } from '../ui/Skeleton';
import * as journalController from '@/lib/controllers/journalController';
import * as attendanceController from '@/lib/controllers/attendanceController';
import { getCached } from '@/lib/utils/sessionCache';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import { getWitaDateString, getWitaDaysAgo } from '@/lib/utils/witaDate';

// Jendela hari yang dimuat bertahap — bukan seluruh riwayat sekaligus.
// Timeline menumpuk terus seiring tahun ajaran berjalan (jurnal + presensi
// SETIAP pertemuan), jadi memuat semuanya di awal makin lambat terus
// seiring waktu, persis akar masalah "loading lama" yang sudah pernah
// diperbaiki untuk ringkasan Beranda (lihat komentar getJournalsInRange di
// dashboardRepository.ts) — pola yang sama diterapkan di sini. `null`
// berarti "semua riwayat", opsi terakhir kalau guru benar-benar butuhnya.
const WINDOW_STEPS_DAYS: (number | null)[] = [30, 90, 365, null];

type TimelineEvent = {
  id: string;
  type: 'presensi' | 'jurnal';
  date: string;
  time: Date | null;
  title: string;
  detail: string;
};

// Timeline adalah derived view — dirakit dari data jurnal & presensi yang
// sudah ada (bukan collection/event log baru), diurutkan lewat timestamp
// createdAt yang sudah dicatat Firestore saat dokumen dibuat.
function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  const parsed = new Date(value as string);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatTime(date: Date | null): string {
  if (!date) return '--.--';
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

type TimelineTabProps = {
  className: string;
};

export default function TimelineTab({ className }: TimelineTabProps) {
  const { workspaceId } = useWorkspace();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [windowStep, setWindowStep] = useState(0);

  useEffect(() => {
    if (workspaceId && className) {
      setWindowStep(0);
      loadTimeline(WINDOW_STEPS_DAYS[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, className]);

  async function loadTimeline(windowDays: number | null) {
    if (!workspaceId || !className) return;
    const startDate = windowDays == null ? null : getWitaDaysAgo(windowDays);
    const endDate = getWitaDateString();
    const rangeKey = startDate
      ? journalController.journalHistoryRangeCacheKey(workspaceId, className, startDate, endDate)
      : journalController.journalHistoryCacheKey(workspaceId, className);
    const alreadyWarm = getCached(rangeKey) !== undefined;
    if (!alreadyWarm) {
      setLoading(true);
    }
    try {
      const [journals, attendances] = startDate
        ? await Promise.all([
            journalController.fetchJournalHistoryInRange(workspaceId, className, startDate, endDate),
            attendanceController.fetchAttendanceHistoryInRange(workspaceId, className, startDate, endDate),
          ])
        : await Promise.all([
            // windowDays === null = "semua riwayat", satu-satunya kondisi
            // yang masih memakai jalur lama tanpa batas tanggal.
            journalController.fetchJournalHistory(workspaceId, className),
            attendanceController.fetchAttendanceHistory(workspaceId, className),
          ]);

      const journalEvents: TimelineEvent[] = journals.map((j: any) => ({
        id: `jurnal-${j.id}`,
        type: 'jurnal',
        date: j.date,
        time: toDate(j.createdAt),
        title: `Materi: ${j.topic}`,
        detail: j.subject || '',
      }));

      const attendanceEvents: TimelineEvent[] = attendances.map((a: any) => {
        const hadir = a.summary?.hadir ?? 0;
        const total = (a.details || []).length;
        return {
          id: `presensi-${a.id}`,
          type: 'presensi' as const,
          date: a.date,
          time: toDate(a.createdAt),
          title: 'Presensi selesai',
          detail: total > 0 ? `${hadir}/${total} hadir` : '',
        };
      });

      const merged = [...journalEvents, ...attendanceEvents].sort((x, y) => {
        if (x.date !== y.date) return y.date.localeCompare(x.date);
        return (x.time?.getTime() ?? 0) - (y.time?.getTime() ?? 0);
      });

      setEvents(merged);
    } catch (error) {
      console.error('Gagal memuat timeline:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function loadOlder() {
    const nextStep = windowStep + 1;
    if (nextStep >= WINDOW_STEPS_DAYS.length) return;
    setLoadingMore(true);
    setWindowStep(nextStep);
    await loadTimeline(WINDOW_STEPS_DAYS[nextStep]);
  }

  const hasOlderWindow = windowStep < WINDOW_STEPS_DAYS.length - 1;

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-200 rounded animate-pulse" />
          <SkeletonText lines={1} className="w-32" />
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const groups: { date: string; items: TimelineEvent[] }[] = [];
  events.forEach((e) => {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) {
      last.items.push(e);
    } else {
      groups.push({ date: e.date, items: [e] });
    }
  });

  return (
    <Card className="space-y-6">
      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
        <Clock className="w-4 h-4 text-blue-600" />
        Riwayat Aktivitas Kelas {className}
      </h3>

      {groups.length === 0 ? (
        <div className="text-xs text-gray-400 py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200 space-y-2">
          <p>
            {hasOlderWindow
              ? 'Belum ada aktivitas dalam rentang waktu ini.'
              : 'Belum ada aktivitas tercatat untuk kelas ini.'}
          </p>
          {hasOlderWindow && (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingMore}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:underline disabled:opacity-50"
            >
              <History className="w-3.5 h-3.5" />
              {loadingMore ? 'Memuat...' : 'Muat riwayat lebih lama'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.date} className="space-y-3">
              <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">
                {formatDateLabel(group.date)}
              </p>
              <div className="relative pl-6 space-y-4 border-l-2 border-gray-100">
                {group.items.map((item) => (
                  <div key={item.id} className="relative">
                    <span
                      className={`absolute -left-[27px] top-0.5 w-3 h-3 rounded-full border-2 border-white ${
                        item.type === 'jurnal' ? 'bg-blue-500' : 'bg-emerald-500'
                      }`}
                    />
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-extrabold text-gray-900 shrink-0 w-12">{formatTime(item.time)}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                          {item.type === 'jurnal' ? (
                            <BookOpen className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          )}
                          <span className="truncate">{item.title}</span>
                        </p>
                        {item.detail && <p className="text-[11px] text-gray-500 mt-0.5">{item.detail}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {hasOlderWindow && (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingMore}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              {loadingMore ? 'Memuat...' : 'Muat riwayat lebih lama'}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
