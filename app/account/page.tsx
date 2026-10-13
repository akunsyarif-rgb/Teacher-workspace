"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";
import InviteCodeCard from "@/src/components/workspace/InviteCodeCard";
import { User, ChevronRight, LogOut, BarChart3, Wallet, Database, ShieldCheck, HardDriveDownload } from "lucide-react";

export default function AccountPage() {
  const router = useRouter();
  const { user, teacherProfile, workspace, role } = useWorkspace();
  async function handleLogout() {
    try {
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Gagal keluar:", error);
    }
  }

  // Kode undangan hanya berarti untuk workspace sekolah (school_annual) —
  // individual tidak pernah punya lebih dari satu guru. Hanya OWNER/ADMIN
  // yang boleh melihat/membuat ulang, sama seperti pembatasan di
  // firestore.rules (workspace_invites allow create/update hanya utk owner).
  const isOwnerOfSchool = role === "OWNER" && workspace?.plan === "school_annual";
  const canManageInviteCode = (role === "OWNER" || role === "ADMIN") && workspace?.plan === "school_annual";

  return (
    <div className="min-h-screen bg-nb-workspace p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-nb-green text-white flex items-center justify-center shadow-md shadow-nb-green/20">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-nb-ink">Akun</h1>
            <p className="text-xs text-nb-ink-muted">Profil, statistik, dan sesi masuk</p>
          </div>
        </div>

        <WorkspaceGuard>
          <div className="bg-nb-paper p-5 rounded-3xl shadow-sm border border-nb-rule space-y-1">
            <p className="text-sm font-extrabold text-nb-ink">{teacherProfile?.name || "Guru Pengajar"}</p>
            <p className="text-xs text-nb-ink-muted">{user?.email}</p>
            {teacherProfile?.subject && (
              <p className="text-xs text-nb-ink-muted">
                Mapel Utama: <span className="font-bold text-nb-green">{teacherProfile.subject}</span>
              </p>
            )}
          </div>

          {canManageInviteCode && <InviteCodeCard />}

          {isOwnerOfSchool && (
            <Link
              href="/admin"
              className="flex items-center justify-between gap-3 p-4 bg-nb-paper rounded-3xl shadow-sm border border-nb-rule hover:bg-nb-workspace transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-nb-ink">
                <ShieldCheck className="w-4 h-4 text-nb-green" />
                Menu Admin — Kelola Guru
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
          )}

          <div className="bg-nb-paper rounded-3xl shadow-sm border border-nb-rule divide-y divide-gray-100 overflow-hidden">
            <Link
              href="/profile"
              className="flex items-center justify-between gap-3 p-4 hover:bg-nb-workspace transition-colors"
            >
              <span className="text-xs font-bold text-nb-ink">Ubah Profil & Pengaturan</span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              href="/analytics"
              className="flex items-center justify-between gap-3 p-4 hover:bg-nb-workspace transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-nb-ink">
                <BarChart3 className="w-4 h-4 text-nb-ink-muted" />
                Statistik & Laporan
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              href="/account/data-arsip"
              className="flex items-center justify-between gap-3 p-4 hover:bg-nb-workspace transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-nb-ink">
                <Database className="w-4 h-4 text-nb-ink-muted" />
                Data & Arsip
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              href="/account/backup"
              className="flex items-center justify-between gap-3 p-4 hover:bg-nb-workspace transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-nb-ink">
                <HardDriveDownload className="w-4 h-4 text-nb-ink-muted" />
                Backup & Ekspor Data
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              href="/upgrade"
              className="flex items-center justify-between gap-3 p-4 hover:bg-nb-workspace transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-nb-ink">
                <Wallet className="w-4 h-4 text-nb-ink-muted" />
                Paket Berlangganan
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 p-4 bg-nb-paper hover:bg-red-50 text-red-600 rounded-3xl shadow-sm border border-nb-rule hover:border-red-200 text-xs font-bold transition-colors active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4" />
            Keluar
          </button>
        </WorkspaceGuard>
      </div>
    </div>
  );
}
