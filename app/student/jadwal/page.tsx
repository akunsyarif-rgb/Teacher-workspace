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
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <p className="text-xs text-gray-400 text-center py-4">
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
          <div key={day.day} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-3">
            <h3 className="text-xs font-extrabold text-blue-600 uppercase tracking-wider flex items-center gap-1.5 border-b border-gray-100 pb-3">
              <Calendar className="w-4 h-4" />
              <span>{day.day}</span>
            </h3>
            <div className="space-y-2">
              {day.items.map((item: any) => (
                <div key={item.id} className="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                  <p className="text-xs font-extrabold text-gray-900">{item.subject}</p>
                  <p className="text-[10px] font-bold text-blue-600">{item.timeSlot}</p>
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
