'use client';

import React from 'react';
import { Users, ChevronRight } from 'lucide-react';

type ClassCardProps = {
  className: string;
  count: number;
  onClick: () => void;
};

export default function ClassCard({ className, count, onClick }: ClassCardProps) {
  return (
    <div
      onClick={onClick}
      className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hover:border-emerald-300 hover:shadow-md cursor-pointer transition-all flex flex-col justify-between gap-6 group"
    >
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 font-extrabold text-xs flex items-center justify-center group-hover:scale-105 transition-transform">
            <Users className="w-5 h-5" />
          </span>
          <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
        </div>
        <div>
          <p className="text-base font-extrabold text-gray-900 mt-2">{className}</p>
          <p className="text-xs font-bold text-gray-400 mt-0.5">{count} Siswa Terdaftar</p>
        </div>
      </div>
      <div className="pt-3 border-t border-gray-50 flex items-center justify-between text-[11px] font-bold text-emerald-600">
        <span>Kelola Absensi & Siswa</span>
        <span>→</span>
      </div>
    </div>
  );
}
