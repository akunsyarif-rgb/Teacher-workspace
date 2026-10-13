"use client";

import React from "react";
import AttendanceForm from "@/src/components/AttendanceForm";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";

export default function AttendancePage() {
  return (
    <div className="min-h-screen bg-[#F7F5EF] p-4 sm:p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <WorkspaceGuard>
          <AttendanceForm />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
