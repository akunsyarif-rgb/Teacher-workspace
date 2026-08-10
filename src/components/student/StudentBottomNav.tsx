'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calendar, ClipboardList, Table, UserCheck, User } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/student', label: 'Beranda', icon: Home },
  { href: '/student/jadwal', label: 'Jadwal', icon: Calendar },
  { href: '/student/tugas', label: 'Tugas', icon: ClipboardList },
  { href: '/student/nilai', label: 'Nilai', icon: Table },
  { href: '/student/presensi', label: 'Hadir', icon: UserCheck },
  // Satu-satunya jalan ke tombol Keluar (lihat app/student/profil/page.tsx)
  // — tanpa ini siswa yang sudah login tidak punya cara terlihat untuk
  // kembali ke halaman login.
  { href: '/student/profil', label: 'Profil', icon: User },
];

export default function StudentBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
      <div className="max-w-md mx-auto grid grid-cols-6">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/student' ? pathname === '/student' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-bold transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'scale-105' : ''} transition-transform`} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
