'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Archive, Trash2, ChevronRight } from 'lucide-react';
import WorkspaceGuard from '@/src/components/ui/WorkspaceGuard';
import DownloadDataPanel from '@/src/components/data-archive/DownloadDataPanel';
import AcademicYearArchivePanel from '@/src/components/data-archive/AcademicYearArchivePanel';
import CleanupDataPanel from '@/src/components/data-archive/CleanupDataPanel';

type Section = 'download' | 'archive' | 'cleanup' | null;

const MENU = [
  {
    key: 'download' as const,
    title: 'Download Data',
    subtitle: 'Ekspor PDF, CSV, atau backup JSON lintas kelas/periode',
    icon: Download,
    color: 'bg-blue-600',
  },
  {
    key: 'archive' as const,
    title: 'Arsip Tahun Ajaran',
    subtitle: 'Tutup tahun ajaran, mulai baru, lihat data tahun lalu',
    icon: Archive,
    color: 'bg-emerald-600',
  },
  {
    key: 'cleanup' as const,
    title: 'Bersihkan Data',
    subtitle: 'Hapus data lama/percobaan secara permanen',
    icon: Trash2,
    color: 'bg-red-600',
  },
];

export default function DataArsipPage() {
  const [activeSection, setActiveSection] = useState<Section>(null);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href={activeSection ? '#' : '/account'}
            onClick={(e) => {
              if (activeSection) {
                e.preventDefault();
                setActiveSection(null);
              }
            }}
            className="p-2.5 -m-1.5 text-gray-400 hover:text-gray-900 transition-colors"
            aria-label="Kembali"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Data & Arsip</h1>
            <p className="text-xs text-gray-500">Pusat pengelolaan data — unduh, arsipkan, dan bersihkan</p>
          </div>
        </div>

        <WorkspaceGuard>
          {activeSection === 'download' && <DownloadDataPanel />}
          {activeSection === 'archive' && <AcademicYearArchivePanel />}
          {activeSection === 'cleanup' && <CleanupDataPanel />}

          {!activeSection && (
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {MENU.map(({ key, title, subtitle, icon: Icon, color }) => (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  className="w-full flex items-center gap-4 p-5 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className={`w-10 h-10 rounded-2xl ${color} text-white flex items-center justify-center shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-gray-900">{title}</p>
                    <p className="text-[11px] text-gray-500 truncate">{subtitle}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </WorkspaceGuard>
      </div>
    </div>
  );
}
