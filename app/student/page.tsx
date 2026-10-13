"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Calendar, ClipboardList, Table, UserCheck, LogOut, ChevronRight, Megaphone, BookOpen, ExternalLink } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";
import { SkeletonCard } from "@/src/components/ui/Skeleton";
import * as studentPortalController from "@/lib/controllers/studentPortalController";
import { isUlanganEnabled } from "@/lib/config/ulangan";
import type { StudentProfile } from "@/src/context/StudentAuthContext";

const NOTEBOOK_LM_URL = "https://notebook.google.com/notebook/048a08e5-7f96-4731-9839-2c6353cb523f";

const MENU_ITEMS = [
  { href: "/student/jadwal", label: "Jadwal", description: "Jadwal pelajaran kelasmu", icon: Calendar },
  ...(isUlanganEnabled() ? [{ href: "/student/ulangan", label: "Ulangan", description: "Ulangan harian kelasmu", icon: ClipboardCheck }] : []),
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
      <div className="bg-nb-paper p-5 rounded-3xl border border-nb-rule shadow-sm flex items-center justify-between gap-3">
        <Link href="/student/profil" className="flex items-center gap-3 min-w-0 group">
          <div className="w-10 h-10 rounded-2xl bg-nb-green text-white flex items-center justify-center font-extrabold shrink-0">
            {profile.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-nb-ink truncate group-hover:text-nb-green transition-colors">
              {profile.name}
            </p>
            <p className="text-xs text-nb-ink-muted">Kelas {profile.className} • Lihat profil</p>
          </div>
        </Link>
        <button
          onClick={handleLogout}
          className="p-2.5 rounded-xl text-nb-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
          title="Keluar"
          aria-label="Keluar"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      <section
        aria-labelledby="notebook-llm-title"
        className="relative overflow-hidden bg-nb-paper p-5 rounded-2xl border border-nb-green/30 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-nb-green-soft text-nb-green flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-nb-green">Ruang belajar digital</p>
            <h2 id="notebook-llm-title" className="text-base font-bold text-nb-ink mt-1">Ruang Notebook LLM</h2>
            <p className="text-sm text-nb-ink-muted mt-1">
              Buka notebook pembelajaran berbantuan AI. Gunakan akun Google yang memiliki akses ke notebook ini.
            </p>
            <a
              href={NOTEBOOK_LM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 mt-4 px-4 py-2.5 rounded-xl bg-nb-green text-white text-sm font-semibold hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-green transition-opacity"
            >
              Buka NotebookLM
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </a>
            <p className="text-xs text-nb-ink-muted mt-2">
              Notebook terbuka di tab baru. Jika diminta, masuk menggunakan akun belajar.id.
            </p>
          </div>
        </div>
      </section>

      <div className="space-y-2">
        <p className="text-xs font-extrabold text-nb-ink-muted uppercase tracking-wider flex items-center gap-1.5">
          <Megaphone className="w-3.5 h-3.5" />
          Pengumuman Guru
        </p>
        {loadingAnnouncements ? (
          <SkeletonCard />
        ) : announcements.length === 0 ? (
          <div className="bg-nb-paper p-4 rounded-2xl border border-nb-rule shadow-sm">
            <p className="text-xs text-nb-ink-muted text-center py-2">Belum ada pengumuman.</p>
          </div>
        ) : (
          announcements.map((announcement) => (
            <div key={announcement.id} className="bg-nb-paper p-4 rounded-2xl border border-nb-rule shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-bold text-nb-ink">{announcement.title}</p>
                <p className="text-xs font-bold text-nb-ink-muted shrink-0">{announcement.date}</p>
              </div>
              <p className="text-xs text-nb-ink-muted mt-1 whitespace-pre-wrap">{announcement.body}</p>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        {MENU_ITEMS.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="bg-nb-paper p-4 rounded-2xl border border-nb-rule shadow-sm flex items-center justify-between gap-3 hover:border-nb-rule transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-nb-green-soft text-nb-green flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-nb-ink">{label}</p>
                <p className="text-xs text-nb-ink-muted">{description}</p>
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
