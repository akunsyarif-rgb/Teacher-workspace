"use client";

import React from "react";
import ScheduleManagement from "@/src/components/ScheduleManagement";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";

export default function SchedulePage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <WorkspaceGuard>
          <ScheduleManagement />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
