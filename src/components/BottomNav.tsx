"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BookOpen, Calendar, GraduationCap } from "lucide-react";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import { fetchDashboardSummary } from "@/lib/controllers/dashboardController";

export default function BottomNav() {
  const pathname = usePathname();
  const { workspaceId, teacherProfile } = useWorkspace();
  const [pendingCount, setPendingCount] = useState(0);

  const navItems = [
    { href: "/", label: "Beranda", icon: Home },
    { href: "/classes", label: "Kelas", icon: BookOpen },
    { href: "/schedule", label: "Jadwal", icon: Calendar },
    ...(teacherProfile?.homeroomClassName
      ? [{ href: "/wali-kelas", label: "Wali Kelas", icon: GraduationCap }]
      : []),
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
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
      <div className={`max-w-5xl mx-auto grid ${navItems.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const showBadge = href === "/" && pendingCount > 0;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-bold transition-colors active:scale-95 relative ${
                isActive ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive ? "scale-105" : ""} transition-transform`} />
                {showBadge && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 bg-red-500 text-white text-[8px] font-extrabold rounded-full shadow-md animate-pulse">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </div>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
