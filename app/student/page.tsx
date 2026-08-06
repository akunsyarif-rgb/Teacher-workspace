"use client";

import React, { useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import { GraduationCap, LogOut } from "lucide-react";
import { useStudentAuth } from "@/src/context/StudentAuthContext";

export default function StudentHomePage() {
  const { profile, loading } = useStudentAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !profile) {
      router.push("/student/login");
    }
  }, [loading, profile, router]);

  async function handleLogout() {
    await signOut(auth);
    router.push("/student/login");
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center animate-pulse shadow-lg shadow-blue-200">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        <p className="text-xs font-bold text-gray-500 tracking-wide">Memuat...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-sm mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center shadow-md shadow-blue-200">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-gray-900">{profile.name}</p>
              <p className="text-xs text-gray-500">Kelas {profile.className}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Keluar"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm text-center space-y-2">
          <p className="text-sm font-bold text-gray-900">Kamu berhasil masuk 🎉</p>
          <p className="text-xs text-gray-500">
            Jadwal, tugas, nilai, dan riwayat kehadiranmu akan muncul di sini menyusul.
          </p>
        </div>
      </div>
    </div>
  );
}
