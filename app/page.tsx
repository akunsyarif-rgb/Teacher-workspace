"use client";

import React, { useState, useEffect, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import { fetchDashboardSummary } from "@/lib/controllers/dashboardController";
import { saveTeacherQuickNote } from "@/lib/controllers/teacherProfileController";
import { isScheduleOngoing, resolveCurrentWorkflowStep } from "@/lib/utils/scheduleTime";
import type { TodayClassStatus } from "@/lib/services/dashboardService";
import { useOnlineStatus } from "@/src/hooks/useOnlineStatus";
import {
  GraduationCap,
  BookOpen,
  Calendar,
  Clock,
  Settings,
  Users,
  FileText,
  Wifi,
  WifiOff,
  BarChart3,
  ArrowRight,
  RefreshCw,
} from "lucide-react";

function getGreeting(date: Date = new Date()) {
  const hour = date.getHours();
  if (hour < 11) return "Selamat Pagi";
  if (hour < 15) return "Selamat Siang";
  if (hour < 18) return "Selamat Sore";
  return "Selamat Malam";
}

function getCompleteDateLabel(date: Date = new Date()) {
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type SyncStatus = "idle" | "saving" | "saved" | "error" | "offline";

export default function DashboardPage() {
  const router = useRouter();
  const { user, teacherProfile, workspaceId, loading: profileLoading } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [quickNote, setQuickNote] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const isOnline = useOnlineStatus();

  const [uniqueClasses, setUniqueClasses] = useState<string[]>([]);
  const [totalJournals, setTotalJournals] = useState(0);
  const [currentDayName, setCurrentDayName] = useState("");
  const [todayProgress, setTodayProgress] = useState<{
    total: number;
    journalsDone: number;
    attendancesDone: number;
    percentage: number;
  }>({ total: 0, journalsDone: 0, attendancesDone: 0, percentage: 0 });
  const [pendingClasses, setPendingClasses] = useState<string[]>([]);
  const [todayClassStatuses, setTodayClassStatuses] = useState<TodayClassStatus[]>([]);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const teacherName = teacherProfile?.name || "Guru Pengajar";
  const subject = teacherProfile?.subject || "";

  useEffect(() => {
    if (isOnline) {
      setSyncStatus((prev) => (prev === "offline" ? "idle" : prev));
    } else {
      setSyncStatus("offline");
    }
  }, [isOnline]);

  useEffect(() => {
    if (teacherProfile?.quickNote !== undefined) {
      setQuickNote(teacherProfile.quickNote);
    }
  }, [teacherProfile]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/login");
        setLoading(false);
        return;
      }
      if (!profileLoading && workspaceId) {
        await loadSummary();
        setLoading(false);
      } else if (!profileLoading && !workspaceId) {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [router, profileLoading, workspaceId]);

  useEffect(() => {
    if (!profileLoading && workspaceId && !loading) {
      loadSummary();
    }
  }, [profileLoading, workspaceId]);

  async function loadSummary() {
    if (!workspaceId) return;
    try {
      const summary = await fetchDashboardSummary(workspaceId);
      setUniqueClasses(summary.uniqueClasses);
      setTotalJournals(summary.totalJournals);
      setCurrentDayName(summary.currentDayName);
      setTodayProgress(summary.todayProgress);
      setPendingClasses(summary.pendingClasses || []);
      setTodayClassStatuses(summary.todayClassStatuses || []);
    } catch (err) {
      console.error("Gagal memuat ringkasan:", err);
    }
  }

  async function saveQuickNoteToFirestore(note: string) {
    if (!user) return;
    if (!isOnline) {
      setSyncStatus("offline");
      return;
    }
    setSyncStatus("saving");
    try {
      await saveTeacherQuickNote(user.uid, note);
      setSyncStatus("saved");
      setTimeout(() => {
        setSyncStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 2000);
    } catch (err) {
      console.error("Gagal menyimpan catatan:", err);
      // Beda dari status "saved" (auto-hilang), status "error" sengaja
      // dibiarkan menetap sampai guru menekan "Coba lagi" — badge yang
      // hilang otomatis dalam 3 detik tanpa aksi retry membuat guru tidak
      // sempat menyadari catatannya gagal tersimpan.
      setSyncStatus("error");
    }
  }

  function handleQuickNoteChange(val: string) {
    setQuickNote(val);
    if (!isOnline) {
      setSyncStatus("offline");
      return;
    }
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    setSyncStatus("saving");
    debounceTimer.current = setTimeout(() => {
      saveQuickNoteToFirestore(val);
    }, 1500);
  }

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  async function handleLogout() {
    try {
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Gagal keluar:", error);
    }
  }

  if (loading || profileLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center animate-pulse shadow-lg shadow-blue-200">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        <p className="text-xs font-bold text-gray-500 tracking-wide">Memuat Beranda...</p>
      </div>
    );
  }

  if (user && !workspaceId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 text-center space-y-3 max-w-md">
          <div className="w-16 h-16 mx-auto bg-amber-50 rounded-full flex items-center justify-center">
            <span className="text-3xl">🏫</span>
          </div>
          <h3 className="text-sm font-extrabold text-gray-700">Belum Ada Workspace</h3>
          <p className="text-xs text-gray-500">
            Anda belum terdaftar dalam workspace. Silakan hubungi admin sekolah atau buat workspace baru.
          </p>
          <button
            onClick={handleLogout}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors"
          >
            Keluar & Login Ulang
          </button>
        </div>
      </div>
    );
  }

  const SyncIndicator = () => {
    if (syncStatus === "offline") {
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full border border-red-200">
          <WifiOff className="w-3.5 h-3.5" />
          Offline
        </span>
      );
    }
    if (syncStatus === "saving") {
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-200 animate-pulse">
          <Wifi className="w-3.5 h-3.5" />
          Menyimpan...
        </span>
      );
    }
    if (syncStatus === "saved") {
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200">
          <Wifi className="w-3.5 h-3.5" />
          Tersimpan
        </span>
      );
    }
    if (syncStatus === "error") {
      return (
        <button
          type="button"
          onClick={() => saveQuickNoteToFirestore(quickNote)}
          className="flex items-center gap-1.5 text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-full border border-red-200 transition-colors active:scale-95"
          aria-label="Gagal simpan catatan, tap untuk coba lagi"
        >
          <WifiOff className="w-3.5 h-3.5" />
          Gagal simpan — Coba lagi
          <RefreshCw className="w-3 h-3" />
        </button>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50/60 px-3 py-1.5 rounded-full border border-emerald-200/50">
        <Wifi className="w-3.5 h-3.5" />
        Tersinkron
      </span>
    );
  };

  const hasPending = pendingClasses.length > 0;
  const workflowStep = resolveCurrentWorkflowStep(todayClassStatuses);
  const { total: todayTotal, journalsDone, attendancesDone, percentage } = todayProgress;
  const isDayComplete = todayTotal > 0 && journalsDone === todayTotal && attendancesDone === todayTotal;
  const isDayPartial = journalsDone > 0 || attendancesDone > 0;

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">
      <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
        {/* Header */}
        <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[10px] font-bold text-blue-600 uppercase tracking-wider bg-blue-50/60 px-2.5 py-1 rounded-xl w-fit">
              <Calendar className="w-3 h-3" />
              <span>{getCompleteDateLabel()}</span>
            </div>
            <h1 className="text-xl md:text-2xl font-extrabold text-gray-900 flex items-center gap-2">
              {getGreeting()}, {teacherName}
            </h1>
            <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
              <span>
                Mapel Utama:{" "}
                <strong className="text-blue-600">{subject || "Belum diatur"}</strong>
              </span>
              <Link
                href="/account"
                className="text-gray-400 hover:text-blue-600 transition-colors active:scale-90 p-2.5 -m-1.5"
                title="Akun"
                aria-label="Akun"
              >
                <Settings className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <SyncIndicator />
            <Link
              href="/analytics"
              className="flex items-center gap-1.5 px-3 py-3 bg-gray-50 hover:bg-blue-50 text-gray-600 hover:text-blue-600 rounded-xl text-xs font-bold transition-all active:scale-95 border border-gray-200 hover:border-blue-200 shadow-sm"
              title="Lihat Statistik"
              aria-label="Lihat Statistik"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Statistik</span>
            </Link>
          </div>
        </div>

        {/* Summary: statistik jadi info sekunder, bukan CTA utama —
            detail lengkap ada di /analytics. */}
        <Link
          href="/analytics"
          className="flex items-center justify-between gap-2 px-4 py-2.5 bg-white rounded-2xl border border-gray-100 shadow-sm text-[11px] md:text-xs font-bold text-gray-500 hover:border-blue-200 hover:text-blue-600 transition-colors"
        >
          <span>
            {uniqueClasses.length} Kelas &middot; {totalJournals} Jurnal Terisi
          </span>
          <span className="flex items-center gap-1 text-blue-600 shrink-0">
            Lihat Statistik
            <ArrowRight className="w-3 h-3" />
          </span>
        </Link>

        {/* Workflow Engine: satu langkah paling relevan sekarang, dipilihkan otomatis */}
        {workflowStep && (
          <div className="bg-blue-600 p-4 md:p-6 rounded-2xl md:rounded-3xl shadow-lg text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-blue-100">
                {workflowStep.isOngoing ? 'Sedang Berlangsung Sekarang' : 'Sesi Berikutnya'}
              </p>
              <p className="text-lg md:text-xl font-extrabold mt-1 truncate">
                Kelas {workflowStep.status.className} • {workflowStep.status.timeSlot}
              </p>
              <p className="text-xs md:text-sm text-blue-100 mt-1">
                {!workflowStep.status.hasAttendance
                  ? 'Belum presensi hari ini'
                  : !workflowStep.status.hasJournal
                  ? 'Presensi sudah, tinggal isi jurnal'
                  : ''}
              </p>
            </div>
            <Link
              href={`/attendance?class=${encodeURIComponent(workflowStep.status.className)}&tab=${
                !workflowStep.status.hasAttendance ? 'presensi' : 'jurnal'
              }`}
              className="shrink-0 flex items-center justify-center gap-1.5 px-5 py-3 bg-white text-blue-700 rounded-xl text-sm font-extrabold shadow-sm hover:bg-blue-50 transition-colors"
            >
              {workflowStep.isOngoing ? 'Lanjutkan Mengajar' : 'Mulai Sekarang'}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* Perlu Diselesaikan Hari Ini — gabungan Progress + Action Center,
            satu kartu, satu empty state (sebelumnya duplikat di dua kartu). */}
        <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 space-y-3 md:space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
              <h3 className="text-[10px] md:text-xs font-extrabold text-gray-700 uppercase tracking-wider">
                Perlu Diselesaikan Hari Ini ({currentDayName})
              </h3>
            </div>
            {todayTotal > 0 && (
              <span className={`text-[10px] md:text-xs font-extrabold shrink-0 ${
                isDayComplete ? 'text-emerald-600' : isDayPartial ? 'text-amber-600' : 'text-gray-400'
              }`}>
                {journalsDone + attendancesDone} dari {todayTotal * 2} tugas
              </span>
            )}
          </div>

          {todayTotal > 0 && (
            <div className="h-2 md:h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isDayComplete ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>
          )}

          {todayClassStatuses.length === 0 ? (
            <div className="p-4 md:p-6 bg-gray-50 rounded-xl md:rounded-2xl border border-dashed border-gray-200 text-center space-y-1">
              <p className="text-sm font-bold text-gray-600">
                Tidak ada jadwal mengajar untuk hari {currentDayName}. Santai dulu 😊
              </p>
              <Link
                href="/schedule"
                className="inline-block text-[10px] md:text-xs text-blue-600 underline underline-offset-2 font-bold"
              >
                Tambahkan lewat menu Jadwal Mengajar
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {todayClassStatuses.map((status) => {
                const isOngoing = isScheduleOngoing(status.timeSlot || '');
                const nextTab = !status.hasAttendance ? 'presensi' : 'jurnal';
                const label = status.isDone
                  ? `Selesai • ${status.subject || subject}`
                  : !status.hasAttendance && !status.hasJournal
                  ? `Presensi & Jurnal belum diisi • ${status.timeSlot}`
                  : !status.hasAttendance
                  ? `Presensi belum diisi • ${status.timeSlot}`
                  : `Jurnal belum diisi • ${status.timeSlot}`;

                return (
                  <div key={status.scheduleId} className="py-3 md:py-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg md:text-xl shrink-0" aria-hidden>
                        {status.isDone ? '✅' : status.hasJournal || status.hasAttendance ? '🟢' : '🟡'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-gray-900 truncate flex items-center gap-2">
                          Kelas {status.className}
                          {isOngoing && !status.isDone && (
                            <span className="text-[9px] font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                              Berlangsung
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] md:text-xs text-gray-500 truncate">{label}</p>
                      </div>
                    </div>

                    {!status.isDone && (
                      <Link
                        href={`/attendance?class=${encodeURIComponent(status.className)}&tab=${nextTab}`}
                        className="shrink-0 px-3 py-1.5 md:px-4 md:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] md:text-xs font-bold transition-colors shadow-sm"
                      >
                        {status.hasAttendance || status.hasJournal ? 'Lanjut' : 'Mulai'}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Catatan Cepat + Menu Utama */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 space-y-2 md:space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 md:w-9 md:h-9 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <FileText className="w-4 h-4 md:w-4.5 md:h-4.5" />
                </div>
                <p className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Catatan Cepat
                </p>
              </div>
              <span className="text-[8px] md:text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 md:px-2.5 md:py-1 rounded-lg">
                Auto-Save
              </span>
            </div>
            <textarea
              rows={2}
              placeholder="Tulis catatan kilat atau pengingat di sini..."
              value={quickNote}
              onChange={(e) => handleQuickNoteChange(e.target.value)}
              className={`w-full p-2 md:p-3 bg-gray-50 border rounded-xl text-xs font-bold text-gray-900 placeholder:text-gray-400 outline-none resize-none transition-colors ${
                syncStatus === "offline"
                  ? "border-red-300 focus:ring-red-500"
                  : "border-gray-200 focus:ring-2 focus:ring-amber-500"
              }`}
            />
            <p className="text-[9px] md:text-[10px] text-gray-400">
              {isOnline
                ? "Catatan otomatis tersimpan ke akun Anda (sinkron lintas perangkat)."
                : "⚠️ Anda sedang offline. Catatan akan disimpan saat koneksi kembali."}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:gap-4">
            <Link
              href="/attendance"
              className="bg-white p-4 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 hover:border-blue-300 transition-all flex items-center gap-4 group relative"
            >
              {hasPending && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 bg-red-500 text-white text-[9px] font-extrabold rounded-full shadow-md animate-pulse">
                  {pendingClasses.length}
                </span>
              )}
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200 group-hover:scale-105 transition-transform shrink-0">
                <BookOpen className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-gray-900">Pusat Kegiatan Kelas</p>
                <p className="text-[10px] md:text-xs text-gray-500 truncate">Jurnal, Presensi, &amp; Nilai</p>
              </div>
            </Link>

            <Link
              href="/schedule"
              className="bg-white p-4 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 hover:border-blue-300 transition-all flex items-center gap-4 group"
            >
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200 group-hover:scale-105 transition-transform shrink-0">
                <Calendar className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-gray-900">Jadwal Mengajar</p>
                <p className="text-[10px] md:text-xs text-gray-500 truncate">Atur jam &amp; jadwal mingguan</p>
              </div>
            </Link>

            <Link
              href="/classes"
              className="bg-white p-4 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 hover:border-emerald-300 transition-all flex items-center gap-4 group"
            >
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-200 group-hover:scale-105 transition-transform shrink-0">
                <Users className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-gray-900">Manajemen Kelas</p>
                <p className="text-[10px] md:text-xs text-gray-500 truncate">Kelola daftar siswa &amp; impor</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
