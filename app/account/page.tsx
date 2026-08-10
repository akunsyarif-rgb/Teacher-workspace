"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";
import { User, ChevronRight, LogOut, BarChart3, Wallet } from "lucide-react";

export default function AccountPage() {
  const router = useRouter();
  const { user, teacherProfile } = useWorkspace();

  async function handleLogout() {
    try {
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Gagal keluar:", error);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Akun</h1>
            <p className="text-xs text-gray-500">Profil, statistik, dan sesi masuk</p>
          </div>
        </div>

        <WorkspaceGuard>
          <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 space-y-1">
            <p className="text-sm font-extrabold text-gray-900">{teacherProfile?.name || "Guru Pengajar"}</p>
            <p className="text-xs text-gray-500">{user?.email}</p>
            {teacherProfile?.subject && (
              <p className="text-xs text-gray-500">
                Mapel Utama: <span className="font-bold text-blue-600">{teacherProfile.subject}</span>
              </p>
            )}
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden">
            <Link
              href="/profile"
              className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50 transition-colors"
            >
              <span className="text-xs font-bold text-gray-700">Ubah Profil & Pengaturan</span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              href="/analytics"
              className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <BarChart3 className="w-4 h-4 text-gray-400" />
                Statistik & Laporan
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              href="/upgrade"
              className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <Wallet className="w-4 h-4 text-gray-400" />
                Paket Berlangganan
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 p-4 bg-white hover:bg-red-50 text-red-600 rounded-3xl shadow-sm border border-gray-100 hover:border-red-200 text-xs font-bold transition-colors active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4" />
            Keluar
          </button>
        </WorkspaceGuard>
      </div>
    </div>
  );
}
