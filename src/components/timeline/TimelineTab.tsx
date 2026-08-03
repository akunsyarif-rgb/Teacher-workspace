'use client';

import React, { useState, useEffect } from 'react';
import { Clock, BookOpen, UserCheck } from 'lucide-react';
import Card from '../ui/Card';
import { SkeletonText, SkeletonCard } from '../ui/Skeleton';
import * as journalController from '@/lib/controllers/journalController';
import * as attendanceController from '@/lib/controllers/attendanceController';
import { useWorkspace } from '@/src/context/WorkspaceContext';

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

  useEffect(() => {
    if (workspaceId && className) loadTimeline();
  }, [workspaceId, className]);

  async function loadTimeline() {
    if (!workspaceId || !className) return;
    setLoading(true);
    try {
      const [journals, attendances] = await Promise.all([
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
    }
  }

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
        <p className="text-xs text-gray-400 py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
          Belum ada aktivitas tercatat untuk kelas ini.
        </p>
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
        </div>
      )}
    </Card>
  );
}
