"use client";

import React from "react";
import ClassManagement from "@/src/components/ClassManagement";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";

export default function ClassesPage() {
  return (
    <div className="min-h-screen bg-[#F7F5EF] p-4 sm:p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6 text-[#242923]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2F6B4F] text-white shadow-md">
            <span className="text-lg font-extrabold">👥</span>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-[#242923]">Manajemen Kelas</h1>
            <p className="text-sm text-[#5D665E]">Tambah, impor, dan kelola daftar siswa per kelas</p>
          </div>
        </div>
        <WorkspaceGuard>
          <ClassManagement />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
