'use client';

import React from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import WorkspaceGuard from './WorkspaceGuard';

type HomeroomGuardProps = {
  featureName: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
};

function NotHomeroomTeacher({ featureName, icon: Icon }: Omit<HomeroomGuardProps, 'children'>) {
  return (
    <div className="bg-nb-paper p-8 rounded-3xl shadow-sm border border-nb-rule text-center space-y-3">
      <div className="w-16 h-16 mx-auto bg-nb-green-soft rounded-full flex items-center justify-center">
        <Icon className="w-7 h-7 text-nb-green" />
      </div>
      <h3 className="text-sm font-extrabold text-nb-ink">Khusus Wali Kelas</h3>
      <p className="text-xs text-nb-ink-muted max-w-sm mx-auto">
        Fitur {featureName} hanya tersedia untuk guru yang menjadi wali kelas. Atur penugasan
        wali kelas di halaman Profil.
      </p>
      <Link
        href="/profile"
        className="inline-block mt-2 px-4 py-2 bg-nb-green text-white rounded-xl text-xs font-bold hover:bg-nb-green-strong transition-colors"
      >
        Buka Halaman Profil
      </Link>
    </div>
  );
}

export default function HomeroomGuard({ featureName, icon, children }: HomeroomGuardProps) {
  const { teacherProfile } = useWorkspace();

  return (
    <WorkspaceGuard>
      {teacherProfile?.homeroomClassName ? children : <NotHomeroomTeacher featureName={featureName} icon={icon} />}
    </WorkspaceGuard>
  );
}
