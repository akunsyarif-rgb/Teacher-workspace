"use client";

import React from "react";
import ClassManagement from "@/src/components/ClassManagement";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";

export default function ClassesPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-200">
            <span className="text-lg font-extrabold">👥</span>
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Manajemen Kelas</h1>
            <p className="text-xs text-gray-500">Tambah, impor, dan kelola daftar siswa per kelas</p>
          </div>
        </div>
        <WorkspaceGuard>
          <ClassManagement />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
