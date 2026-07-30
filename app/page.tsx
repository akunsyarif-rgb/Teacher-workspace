"use client";

import React from "react";
import { BookOpen, Users, LogOut, CheckSquare, Calendar } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";

export default function Home() {
  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header Dashboard */}
      <header className="bg-white border-b border-gray-100 px-6 py-5 sticky top-0 z-10 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Selamat Datang, Syarif Hidayatullah</h1>
          <p className="text-xs text-gray-500 mt-1">SMA Negeri 2 Tarakan • Tahun Ajaran 2026/2027</p>
        </div>
        <button 
          onClick={handleLogout}
          className="p-2.5 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Konten Utama */}
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Kelas Diampu", value: "4", icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Jurnal Terisi", value: "12", icon: BookOpen, color: "text-emerald-600", bg: "bg-emerald-50" },
            { label: "Tugas Dinilai", value: "85%", icon: CheckSquare, color: "text-purple-600", bg: "bg-purple-50" },
            { label: "Agenda Mendatang", value: "2", icon: Calendar, color: "text-amber-600", bg: "bg-amber-50" },
          ].map((stat, idx) => (
            <div key={idx} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
              <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{stat.label}</p>
                <p className="text-2xl font-extrabold text-gray-900 mt-0.5">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Shortcut Aksi Cepat */}
        <div>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Aksi Cepat</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button className="flex items-center gap-3 p-4 bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl text-left transition-colors shadow-sm">
              <div className="p-2.5 bg-blue-600 text-white rounded-xl">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Isi Jurnal Mengajar</p>
                <p className="text-xs text-gray-500">Catat materi dan presensi hari ini</p>
              </div>
            </button>
            <button className="flex items-center gap-3 p-4 bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl text-left transition-colors shadow-sm">
              <div className="p-2.5 bg-emerald-600 text-white rounded-xl">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Manajemen Kelas</p>
                <p className="text-xs text-gray-500">Lihat data siswa dan nilai</p>
              </div>
            </button>
          </div>
        </div>

      </main>
    </div>
  );
}
