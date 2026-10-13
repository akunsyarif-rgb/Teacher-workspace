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
      className="bg-[#FFFEF9] p-6 rounded-3xl shadow-sm border border-[#D9DED5] hover:border-[#B6C8B8] hover:shadow-md cursor-pointer transition-all flex flex-col justify-between gap-6 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B4F]"
    >
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="w-10 h-10 rounded-2xl bg-[#EDF3E8] text-[#2F6B4F] font-extrabold text-xs flex items-center justify-center group-hover:scale-105 transition-transform">
            <Users className="w-5 h-5" />
          </span>
          <ChevronRight className="w-5 h-5 text-[#A3AAA0] group-hover:text-[#2F6B4F] group-hover:translate-x-1 transition-all" />
        </div>
        <div>
          <p className="text-base font-extrabold text-[#242923] mt-2">{className}</p>
          <p className="text-sm font-bold text-[#5D665E] mt-0.5">{count} Siswa Terdaftar</p>
        </div>
      </div>
      <div className="pt-3 border-t border-[#D9DED5] flex items-center justify-between text-xs font-bold text-[#2F6B4F]">
        <span>Kelola Absensi & Siswa</span>
        <span>→</span>
      </div>
    </div>
  );
}
