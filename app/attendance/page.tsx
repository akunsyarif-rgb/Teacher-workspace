"use client";

import React from "react";
import AttendanceForm from "@/src/components/AttendanceForm";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";

export default function AttendancePage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <WorkspaceGuard>
          <AttendanceForm />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
