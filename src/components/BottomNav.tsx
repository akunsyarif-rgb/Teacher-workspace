"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BookOpen, Calendar, GraduationCap, Users } from "lucide-react";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import { fetchDashboardSummary } from "@/lib/controllers/dashboardController";

export default function BottomNav() {
  const pathname = usePathname();
  const { workspaceId, teacherProfile } = useWorkspace();
  const [pendingCount, setPendingCount] = useState(0);

  // Selalu 4 item — hanya item terakhir yang berganti isi (Siswa vs Wali
  // Kelas) tergantung apakah guru ini wali kelas, supaya layout Bottom Nav
  // tidak ikut berubah lebar/jumlah kolom.
  const navItems = [
    { href: "/", label: "Beranda", icon: Home },
    { href: "/attendance", label: "Kelas Aktif", icon: BookOpen },
    { href: "/schedule", label: "Jadwal", icon: Calendar },
    teacherProfile?.homeroomClassName
      ? { href: "/wali-kelas", label: "Wali Kelas", icon: GraduationCap }
      : { href: "/classes", label: "Siswa", icon: Users },
  ];

  useEffect(() => {
    if (workspaceId) {
      loadPendingCount();
    }
  }, [workspaceId, pathname]);

  async function loadPendingCount() {
    if (!workspaceId) return;
    try {
      const summary = await fetchDashboardSummary(workspaceId);
      setPendingCount(summary.pendingClasses?.length || 0);
    } catch (err) {
      console.error("Gagal memuat notifikasi:", err);
    }
  }

  if (pathname === "/login" || pathname.startsWith("/student")) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#D9DED5] bg-[#FFFEF9]/95 shadow-[0_-2px_10px_rgba(36,41,35,0.05)] backdrop-blur supports-[backdrop-filter]:bg-[#FFFEF9]/90 xl:bottom-0 xl:left-0 xl:right-auto xl:top-0 xl:w-56 xl:border-r xl:border-t-0 xl:shadow-[2px_0_10px_rgba(36,41,35,0.04)]">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-4 px-1 sm:px-3 xl:flex xl:h-full xl:max-w-none xl:flex-col xl:justify-start xl:gap-2 xl:px-3 xl:pt-8">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const showBadge = href === "/attendance" && pendingCount > 0;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-1 min-h-14 min-w-0 py-2.5 text-xs font-bold transition-colors active:scale-95 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2F6B4F] xl:flex-row xl:justify-start xl:gap-3 xl:rounded-xl xl:px-4 xl:py-3 xl:text-sm ${
                isActive ? "text-[#2F6B4F]" : "text-[#5D665E] hover:text-[#242923]"
              }`}
            >
              <div className="relative xl:flex xl:items-center">
                <Icon className={`w-5 h-5 ${isActive ? "scale-105" : ""} transition-transform`} />
                {showBadge && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-5 h-5 px-1 bg-red-600 text-white text-xs font-extrabold rounded-full shadow-md animate-pulse">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </div>
              <span className="max-w-full truncate px-1">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
