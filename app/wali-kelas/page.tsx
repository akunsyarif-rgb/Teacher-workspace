"use client";

import React from "react";
import Link from "next/link";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import HomeroomGuard from "@/src/components/ui/HomeroomGuard";
import { GraduationCap, Wallet, Package, HeartHandshake, Trophy, Phone, ChevronRight } from "lucide-react";

const WALI_KELAS_MENU_ITEMS = [
  { href: "/wali-kelas/kas", label: "Kas Kelas", desc: "Pemasukan & pengeluaran kas kelas", icon: Wallet },
  { href: "/wali-kelas/inventaris", label: "Inventaris", desc: "Barang inventaris dan kondisinya", icon: Package },
  { href: "/wali-kelas/konseling", label: "Konseling", desc: "Sesi konseling dan tindak lanjut siswa", icon: HeartHandshake },
  { href: "/wali-kelas/prestasi", label: "Prestasi", desc: "Pencapaian siswa", icon: Trophy },
  { href: "/wali-kelas/komunikasi-ortu", label: "Komunikasi Ortu", desc: "Komunikasi dengan orang tua/wali", icon: Phone },
];

export default function WaliKelasPage() {
  const { teacherProfile } = useWorkspace();

  return (
    <div className="min-h-screen bg-nb-workspace p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-nb-green text-white flex items-center justify-center shadow-md shadow-nb-green/20">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-nb-ink">Wali Kelas</h1>
            <p className="text-xs text-nb-ink-muted">
              {teacherProfile?.homeroomClassName
                ? `Kelas ${teacherProfile.homeroomClassName}`
                : "Menu khusus guru wali kelas"}
            </p>
          </div>
        </div>

        <HomeroomGuard featureName="Wali Kelas" icon={GraduationCap}>
          <div className="bg-nb-paper rounded-3xl shadow-sm border border-nb-rule divide-y divide-gray-100 overflow-hidden">
            {WALI_KELAS_MENU_ITEMS.map(({ href, label, desc, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 p-4 hover:bg-nb-workspace transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-nb-green-soft text-nb-green flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-extrabold text-nb-ink">{label}</p>
                  <p className="text-xs text-nb-ink-muted truncate">{desc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </Link>
            ))}
          </div>
        </HomeroomGuard>
      </div>
    </div>
  );
}
