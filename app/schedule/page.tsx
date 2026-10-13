"use client";

import React from "react";
import ScheduleManagement from "@/src/components/ScheduleManagement";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";

export default function SchedulePage() {
  return (
    <div className="min-h-screen bg-[#F7F5EF] p-4 sm:p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <WorkspaceGuard>
          <ScheduleManagement />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
