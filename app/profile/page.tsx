'use client';

import React from 'react';
import ProfileForm from '@/src/components/profile/ProfileForm';
import PlanStatusCard from '@/src/components/profile/PlanStatusCard';
import WorkspaceGuard from '@/src/components/ui/WorkspaceGuard';

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <WorkspaceGuard>
          <ProfileForm />
          <PlanStatusCard />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
