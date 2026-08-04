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
    <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 text-center space-y-3">
      <div className="w-16 h-16 mx-auto bg-blue-50 rounded-full flex items-center justify-center">
        <Icon className="w-7 h-7 text-blue-600" />
      </div>
      <h3 className="text-sm font-extrabold text-gray-700">Khusus Wali Kelas</h3>
      <p className="text-xs text-gray-500 max-w-sm mx-auto">
        Fitur {featureName} hanya tersedia untuk guru yang menjadi wali kelas. Atur penugasan
        wali kelas di halaman Profil.
      </p>
      <Link
        href="/profile"
        className="inline-block mt-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors"
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
