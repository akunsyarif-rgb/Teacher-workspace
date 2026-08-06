"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import { Calendar, ClipboardList, Table, UserCheck, LogOut, ChevronRight, Megaphone } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";
import { SkeletonCard } from "@/src/components/ui/Skeleton";
import * as studentPortalController from "@/lib/controllers/studentPortalController";
import type { StudentProfile } from "@/src/context/StudentAuthContext";

const MENU_ITEMS = [
  { href: "/student/jadwal", label: "Jadwal", description: "Jadwal pelajaran kelasmu", icon: Calendar },
  { href: "/student/tugas", label: "Tugas", description: "Daftar tugas & pengumpulan", icon: ClipboardList },
  { href: "/student/nilai", label: "Nilai", description: "Nilai dan rata-ratamu", icon: Table },
  { href: "/student/presensi", label: "Kehadiran", description: "Riwayat presensimu", icon: UserCheck },
];

function HomeContent({ profile }: { profile: StudentProfile }) {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await studentPortalController.fetchAnnouncements({
          workspaceId: profile.workspaceId,
          className: profile.className,
          studentId: profile.studentId,
        });
        setAnnouncements(list);
      } catch (error) {
        console.error("Gagal memuat pengumuman:", error);
      } finally {
        setLoadingAnnouncements(false);
      }
    })();
  }, [profile.workspaceId, profile.className, profile.studentId]);

  async function handleLogout() {
    await signOut(auth);
    router.push("/student/login");
  }

  return (
    <div className="space-y-4">
      {/* Kartu identitas sekaligus pintu ke Profil — supaya bottom nav
          tetap 5 item dan tidak sesak di layar HP kecil. */}
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between gap-3">
        <Link href="/student/profil" className="flex items-center gap-3 min-w-0 group">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-extrabold shrink-0">
            {profile.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
              {profile.name}
            </p>
            <p className="text-xs text-gray-500">Kelas {profile.className} • Lihat profil</p>
          </div>
        </Link>
        <button
          onClick={handleLogout}
          className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
          title="Keluar"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <Megaphone className="w-3.5 h-3.5" />
          Pengumuman Guru
        </p>
        {loadingAnnouncements ? (
          <SkeletonCard />
        ) : announcements.length === 0 ? (
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
            <p className="text-[11px] text-gray-400 text-center py-2">Belum ada pengumuman.</p>
          </div>
        ) : (
          announcements.map((announcement) => (
            <div key={announcement.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-bold text-gray-900">{announcement.title}</p>
                <p className="text-[10px] font-bold text-gray-400 shrink-0">{announcement.date}</p>
              </div>
              <p className="text-[11px] text-gray-600 mt-1 whitespace-pre-wrap">{announcement.body}</p>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        {MENU_ITEMS.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between gap-3 hover:border-blue-200 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-900">{label}</p>
                <p className="text-[11px] text-gray-500">{description}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function StudentHomePage() {
  return (
    <StudentShell title="Student Companion" subtitle="Ringkasan belajarmu">
      {(profile) => <HomeContent profile={profile} />}
    </StudentShell>
  );
}
