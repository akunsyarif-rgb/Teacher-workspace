"use client";

import React, { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";
import { SkeletonCard } from "@/src/components/ui/Skeleton";
import * as studentPortalController from "@/lib/controllers/studentPortalController";
import type { StudentProfile } from "@/src/context/StudentAuthContext";

function ScheduleContent({ profile }: { profile: StudentProfile }) {
  const [days, setDays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await studentPortalController.fetchSchedule({
          workspaceId: profile.workspaceId,
          className: profile.className,
          studentId: profile.studentId,
        });
        setDays(result);
      } catch (error) {
        console.error("Gagal memuat jadwal:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [profile.workspaceId, profile.className, profile.studentId]);

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const hasAny = days.some((day) => day.items.length > 0);
  if (!hasAny) {
    return (
      <div className="bg-nb-paper p-6 rounded-3xl border border-nb-rule shadow-sm">
        <p className="text-xs text-nb-ink-muted text-center py-4">
          Gurumu belum mengisi jadwal untuk kelas ini.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {days
        .filter((day) => day.items.length > 0)
        .map((day) => (
          <div key={day.day} className="bg-nb-paper p-5 rounded-3xl border border-nb-rule shadow-sm space-y-3">
            <h3 className="text-xs font-extrabold text-nb-green uppercase tracking-wider flex items-center gap-1.5 border-b border-nb-rule pb-3">
              <Calendar className="w-4 h-4" />
              <span>{day.day}</span>
            </h3>
            <div className="space-y-2">
              {day.items.map((item: any) => (
                <div key={item.id} className="p-3 bg-nb-workspace rounded-2xl border border-nb-rule">
                  <p className="text-xs font-extrabold text-nb-ink">{item.subject}</p>
                  <p className="text-xs font-bold text-nb-green">{item.timeSlot}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

export default function StudentSchedulePage() {
  return (
    <StudentShell title="Jadwal" subtitle="Jadwal pelajaran kelasmu">
      {(profile) => <ScheduleContent profile={profile} />}
    </StudentShell>
  );
}
