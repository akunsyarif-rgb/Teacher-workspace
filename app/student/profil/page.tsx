"use client";

import React, { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import { LogOut, FileText, Trophy, IdCard, Award } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";
import { SkeletonCard } from "@/src/components/ui/Skeleton";
import * as studentPortalController from "@/lib/controllers/studentPortalController";
import type { StudentProfile } from "@/src/context/StudentAuthContext";

function ProfileContent({ profile }: { profile: StudentProfile }) {
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const scope = {
        workspaceId: profile.workspaceId,
        className: profile.className,
        studentId: profile.studentId,
      };
      try {
        const [portfolioResult, achievementResult] = await Promise.all([
          studentPortalController.fetchPortfolio(scope),
          studentPortalController.fetchAchievements(scope),
        ]);
        setPortfolio(portfolioResult);
        setAchievements(achievementResult);
      } catch (error) {
        console.error("Gagal memuat profil:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [profile.workspaceId, profile.className, profile.studentId]);

  async function handleLogout() {
    await signOut(auth);
    router.push("/student/login");
  }

  return (
    <div className="space-y-5">
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-extrabold text-lg shrink-0">
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-gray-900 truncate">{profile.name}</p>
              <p className="text-xs text-gray-500">Kelas {profile.className}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
            title="Keluar"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
          <IdCard className="w-3.5 h-3.5 text-gray-400" />
          <p className="text-[11px] font-bold text-gray-500">NIS: {profile.nis || "-"}</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <Award className="w-3.5 h-3.5" />
          Prestasi
        </p>

        {loading ? (
          <SkeletonCard />
        ) : achievements.length === 0 ? (
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
            <p className="text-[11px] text-gray-400 text-center py-2">
              Belum ada prestasi tercatat. Prestasi yang dicatat wali kelasmu akan muncul di sini.
            </p>
          </div>
        ) : (
          achievements.map((item) => (
            <div
              key={item.id}
              className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-start gap-3"
            >
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <Award className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-gray-900">{item.title}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">{item.date}</p>
                {item.notes && <p className="text-[11px] text-gray-600 mt-1">{item.notes}</p>}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5" />
          Portofolio Tugas
        </p>

        {loading ? (
          <SkeletonCard />
        ) : portfolio.length === 0 ? (
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
            <p className="text-[11px] text-gray-400 text-center py-2">
              Belum ada tugas yang selesai dinilai. Tugas yang sudah dinilai gurumu akan terkumpul di sini.
            </p>
          </div>
        ) : (
          portfolio.map((item) => (
            <div key={item.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-900">{item.title}</p>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">
                    {item.dueDate}
                  </p>
                </div>
                {item.score !== null && (
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-50 text-emerald-700 shrink-0">
                    {item.score}
                  </span>
                )}
              </div>

              {item.fileUrl && (
                <a
                  href={item.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:underline"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {item.fileName || "Lihat lampiran"}
                </a>
              )}

              {item.feedback && (
                <div className="p-2.5 bg-gray-50 rounded-xl">
                  <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Catatan Guru</p>
                  <p className="text-[11px] text-gray-700 mt-0.5">{item.feedback}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function StudentProfilePage() {
  return (
    <StudentShell title="Profil" subtitle="Identitas dan hasil belajarmu">
      {(profile) => <ProfileContent profile={profile} />}
    </StudentShell>
  );
}
