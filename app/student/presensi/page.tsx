"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";
import AttendanceTrendChart from "@/src/components/student/AttendanceTrendChart";
import { SkeletonCard } from "@/src/components/ui/Skeleton";
import * as studentPortalController from "@/lib/controllers/studentPortalController";
import type { StudentProfile } from "@/src/context/StudentAuthContext";

const STATUS_STYLE: Record<string, string> = {
  Hadir: "bg-emerald-50 text-emerald-700",
  Sakit: "bg-amber-50 text-amber-700",
  Izin: "bg-blue-50 text-blue-700",
  Dispensasi: "bg-violet-50 text-violet-700",
  Alpa: "bg-red-50 text-red-700",
};

function AttendanceContent({ profile }: { profile: StudentProfile }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await studentPortalController.fetchAttendance({
          workspaceId: profile.workspaceId,
          className: profile.className,
          studentId: profile.studentId,
        });
        setData(result);
      } catch (error) {
        console.error("Gagal memuat riwayat kehadiran:", error);
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

  if (!data || data.total === 0) {
    return (
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <p className="text-xs text-gray-400 text-center py-4">
          Belum ada riwayat kehadiran untuk kamu.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Tingkat Kehadiran</p>
            <p className="text-2xl font-extrabold text-gray-900">{data.attendanceRate}%</p>
          </div>
          <p className="text-[11px] text-gray-500">dari {data.total} pertemuan</p>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-100">
          {Object.keys(data.summary)
            .filter((status) => data.summary[status] > 0)
            .map((status) => (
              <span
                key={status}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS_STYLE[status] || "bg-gray-50 text-gray-600"}`}
              >
                {status} {data.summary[status]}
              </span>
            ))}
          {data.lateCount > 0 && (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-orange-50 text-orange-700 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Terlambat {data.lateCount}
            </span>
          )}
        </div>
      </div>

      {data.monthly?.length >= 2 && (
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-3">
          <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Kehadiran per Bulan</p>
          <AttendanceTrendChart
            labels={data.monthly.map((item: any) => item.label)}
            rates={data.monthly.map((item: any) => item.rate)}
          />
        </div>
      )}

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {data.history.map((record: any) => (
          <div key={record.id} className="p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-gray-900">{record.date}</p>
              <p className="text-[11px] text-gray-500">{record.subject || "-"}</p>
              {record.keterangan && (
                <p className="text-[11px] text-gray-500 italic mt-0.5">{record.keterangan}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {record.late && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-700">
                  Terlambat
                </span>
              )}
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                  STATUS_STYLE[record.status] || "bg-gray-50 text-gray-600"
                }`}
              >
                {record.status === "Hadir" && <CheckCircle2 className="w-3 h-3" />}
                {record.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StudentAttendancePage() {
  return (
    <StudentShell title="Kehadiran" subtitle="Riwayat presensimu di kelas ini">
      {(profile) => <AttendanceContent profile={profile} />}
    </StudentShell>
  );
}
