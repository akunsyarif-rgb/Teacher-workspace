"use client";

import React from "react";
import Link from "next/link";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";
import { GraduationCap, Wallet, Package, HeartHandshake, Trophy, Phone, ChevronRight } from "lucide-react";

const WALI_KELAS_MENU_ITEMS = [
  { href: "/wali-kelas/kas", label: "Kas Kelas", desc: "Pemasukan & pengeluaran kas kelas", icon: Wallet },
  { href: "/wali-kelas/inventaris", label: "Inventaris", desc: "Barang inventaris dan kondisinya", icon: Package },
  { href: "/wali-kelas/konseling", label: "Konseling", desc: "Sesi konseling dan tindak lanjut siswa", icon: HeartHandshake },
  { href: "/wali-kelas/prestasi", label: "Prestasi", desc: "Pencapaian siswa", icon: Trophy },
  { href: "/wali-kelas/komunikasi-ortu", label: "Komunikasi Ortu", desc: "Komunikasi dengan orang tua/wali", icon: Phone },
];

function NotHomeroomTeacher() {
  return (
    <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 text-center space-y-3">
      <div className="w-16 h-16 mx-auto bg-blue-50 rounded-full flex items-center justify-center">
        <GraduationCap className="w-7 h-7 text-blue-600" />
      </div>
      <h3 className="text-sm font-extrabold text-gray-700">Khusus Wali Kelas</h3>
      <p className="text-xs text-gray-500 max-w-sm mx-auto">
        Menu ini hanya tersedia untuk guru yang menjadi wali kelas. Atur penugasan wali kelas di
        halaman Profil.
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

export default function WaliKelasPage() {
  const { teacherProfile } = useWorkspace();

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Wali Kelas</h1>
            <p className="text-xs text-gray-500">
              {teacherProfile?.homeroomClassName
                ? `Kelas ${teacherProfile.homeroomClassName}`
                : "Menu khusus guru wali kelas"}
            </p>
          </div>
        </div>

        <WorkspaceGuard>
          {teacherProfile?.homeroomClassName ? (
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {WALI_KELAS_MENU_ITEMS.map(({ href, label, desc, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-extrabold text-gray-900">{label}</p>
                    <p className="text-[10px] text-gray-500 truncate">{desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </Link>
              ))}
            </div>
          ) : (
            <NotHomeroomTeacher />
          )}
        </WorkspaceGuard>
      </div>
    </div>
  );
}
