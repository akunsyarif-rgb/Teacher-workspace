"use client";

import React, { useEffect, useState } from "react";
import StudentShell from "@/src/components/student/StudentShell";
import GradeTrendChart from "@/src/components/student/GradeTrendChart";
import { SkeletonCard } from "@/src/components/ui/Skeleton";
import * as studentPortalController from "@/lib/controllers/studentPortalController";
import type { StudentProfile } from "@/src/context/StudentAuthContext";

function GradesContent({ profile }: { profile: StudentProfile }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await studentPortalController.fetchGrades({
          workspaceId: profile.workspaceId,
          className: profile.className,
          studentId: profile.studentId,
        });
        setData(result);
      } catch (error) {
        console.error("Gagal memuat nilai:", error);
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

  if (!data || data.items.length === 0) {
    return (
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <p className="text-xs text-gray-400 text-center py-4">Belum ada komponen nilai di kelas ini.</p>
      </div>
    );
  }

  // Hanya komponen yang sudah dinilai yang masuk grafik — titik kosong
  // akan terbaca sebagai nilai nol.
  const scored = data.items.filter(
    (item: any) => item.score !== null && String(item.score).trim() !== "" && Number.isFinite(Number(item.score))
  );

  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
        <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Rata-rata</p>
        <p className="text-2xl font-extrabold text-gray-900">
          {data.average === null ? "—" : data.average.toFixed(1)}
        </p>
        <p className="text-[11px] text-gray-500">
          {data.average === null
            ? "Belum ada nilai yang masuk"
            : "Dihitung dari komponen yang sudah dinilai saja"}
        </p>
      </div>

      {scored.length >= 2 && (
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-3">
          <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Perkembangan Nilai</p>
          <GradeTrendChart
            labels={scored.map((item: any) => item.title)}
            scores={scored.map((item: any) => Number(item.score))}
          />
          <p className="text-[10px] text-gray-400 text-center">Urut sesuai komponen penilaian</p>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {data.items.map((item: any) => (
          <div key={item.id} className="p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-gray-900">{item.title}</p>
              <p className="text-[11px] text-gray-500">{item.type}</p>
            </div>
            {item.score === null || String(item.score).trim() === "" ? (
              <span className="text-[11px] font-bold text-gray-300">Belum dinilai</span>
            ) : (
              <span className="text-sm font-extrabold text-gray-900">{item.score}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StudentGradesPage() {
  return (
    <StudentShell title="Nilai" subtitle="Nilaimu di mata pelajaran ini">
      {(profile) => <GradesContent profile={profile} />}
    </StudentShell>
  );
}
