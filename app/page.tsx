"use client";

import React, { useState, useEffect, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import { fetchDashboardSummary } from "@/lib/controllers/dashboardController";
import { saveTeacherQuickNote } from "@/lib/controllers/teacherProfileController";
import {
  GraduationCap,
  LogOut,
  BookOpen,
  Calendar,
  Clock,
  Settings,
  Users,
  FileText,
  ChevronRight,
  Wifi,
  WifiOff,
  CheckCircle2,
  Circle,
  AlertCircle,
  BarChart3,
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

function isScheduleOngoing(timeSlot: string): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const timeRangeRegex = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;
  const match = timeSlot.match(timeRangeRegex);
  if (match) {
    const startHour = parseInt(match[1], 10);
    const startMin = parseInt(match[2], 10);
    const endHour = parseInt(match[3], 10);
    const endMin = parseInt(match[4], 10);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  const jamKeRegex = /Jam Ke[- ](\d+)\s*s\.d\.\s*(\d+)/i;
  const jamMatch = timeSlot.match(jamKeRegex);
  if (jamMatch) {
    const startKe = parseInt(jamMatch[1], 10);
    const endKe = parseInt(jamMatch[2], 10);
    const baseMinutes = 7 * 60 + 30;
    const startMinutes = baseMinutes + (startKe - 1) * 45;
    const endMinutes = baseMinutes + endKe * 45;
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return false;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, teacherProfile, workspaceId, loading: profileLoading } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [quickNote, setQuickNote] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  const [uniqueClasses, setUniqueClasses] = useState<string[]>([]);
  const [totalJournals, setTotalJournals] = useState(0);
  const [todaySchedules, setTodaySchedules] = useState<any[]>([]);
  const [currentDayName, setCurrentDayName] = useState("");
  const [todayProgress, setTodayProgress] = useState<{
    total: number;
    journalsDone: number;
    attendancesDone: number;
    percentage: number;
  }>({ total: 0, journalsDone: 0, attendancesDone: 0, percentage: 0 });
  const [pendingClasses, setPendingClasses] = useState<string[]>([]);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const teacherName = teacherProfile?.name || "Guru Pengajar";
  const subject = teacherProfile?.subject || "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => {
      setIsOnline(true);
      setSyncStatus((prev) => (prev === "offline" ? "idle" : prev));
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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
      setTodaySchedules(summary.todaySchedules);
      setCurrentDayName(summary.currentDayName);
      setTodayProgress(summary.todayProgress);
      setPendingClasses(summary.pendingClasses || []);
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
      setSyncStatus("error");
      setTimeout(() => {
        setSyncStatus((prev) => (prev === "error" ? "idle" : prev));
      }, 3000);
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
        <span className="flex items-center gap-1.5 text-[10px] font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full border border-red-200">
          <WifiOff className="w-3.5 h-3.5" />
          Gagal simpan
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50/60 px-3 py-1.5 rounded-full border border-emerald-200/50">
        <Wifi className="w-3.5 h-3.5" />
        Tersinkron
      </span>
    );
  };

  const ProgressCard = () => {
    const { total, journalsDone, attendancesDone, percentage } = todayProgress;

    if (total === 0) {
      return (
        <div className="bg-white p-4 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
            <h3 className="text-[10px] md:text-xs font-extrabold text-gray-700 uppercase tracking-wider">
              Progress Hari Ini
            </h3>
          </div>
          <p className="text-xs md:text-sm font-medium text-gray-500">
            Tidak ada jadwal mengajar hari ini. Santai dulu 😊
          </p>
        </div>
      );
    }

    const isComplete = journalsDone === total && attendancesDone === total;
    const isPartial = journalsDone > 0 || attendancesDone > 0;

    return (
      <div className={`p-4 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border transition-all ${
        isComplete 
          ? 'bg-emerald-50 border-emerald-200' 
          : isPartial 
            ? 'bg-amber-50 border-amber-200' 
            : 'bg-gray-50 border-gray-200'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isComplete ? (
              <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5 text-emerald-600" />
            ) : (
              <Clock className="w-4 h-4 md:w-5 md:h-5 text-amber-600" />
            )}
            <h3 className="text-[10px] md:text-xs font-extrabold text-gray-700 uppercase tracking-wider">
              Progress Hari Ini
            </h3>
          </div>
          <span className={`text-[10px] md:text-xs font-extrabold ${
            isComplete ? 'text-emerald-600' : isPartial ? 'text-amber-600' : 'text-gray-400'
          }`}>
            {journalsDone + attendancesDone} dari {total * 2} tugas
          </span>
        </div>

        <div className="mt-2 h-2 md:h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${
              isComplete ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] md:text-xs font-medium">
          <div className="flex items-center gap-1.5">
            {journalsDone === total ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            ) : journalsDone > 0 ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-gray-300" />
            )}
            <span className={journalsDone === total ? 'text-emerald-700' : 'text-gray-600'}>
              Jurnal: {journalsDone}/{total}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {attendancesDone === total ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            ) : attendancesDone > 0 ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-gray-300" />
            )}
            <span className={attendancesDone === total ? 'text-emerald-700' : 'text-gray-600'}>
              Presensi: {attendancesDone}/{total}
            </span>
          </div>
        </div>

        {!isComplete && pendingClasses.length > 0 && (
          <Link
            href="/attendance"
            className="mt-3 inline-block text-[10px] md:text-xs font-bold text-blue-600 hover:underline"
          >
            ⚠️ {pendingClasses.length} kelas perlu dilengkapi: {pendingClasses.join(', ')}
          </Link>
        )}
      </div>
    );
  };

  const hasPending = pendingClasses.length > 0;

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
                href="/profile"
                className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                title="Ubah Profil"
              >
                <Settings className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <SyncIndicator />
            <Link
              href="/analytics"
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 hover:bg-blue-50 text-gray-600 hover:text-blue-600 rounded-xl text-xs font-bold transition-all border border-gray-200 hover:border-blue-200 shadow-sm"
              title="Lihat Statistik"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Statistik</span>
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-xl text-xs font-bold transition-all border border-gray-200 hover:border-red-200 shadow-sm"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </div>

        {/* Statistik */}
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <Link
            href="/classes"
            className="bg-white p-3 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 hover:border-emerald-300 hover:shadow-md transition-all flex items-center gap-3 group cursor-pointer"
          >
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Users className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate">Kelas Diampu</p>
              <p className="text-xl md:text-2xl font-extrabold text-gray-900">{uniqueClasses.length}</p>
            </div>
            <ChevronRight className="w-3 h-3 md:w-4 md:h-4 text-gray-300 group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
          </Link>

          <Link
            href="/attendance"
            className="bg-white p-3 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 hover:border-emerald-300 hover:shadow-md transition-all flex items-center gap-3 group cursor-pointer relative"
          >
            {hasPending && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 bg-red-500 text-white text-[9px] font-extrabold rounded-full shadow-md animate-pulse">
                {pendingClasses.length}
              </span>
            )}
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <BookOpen className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate">Jurnal Terisi</p>
              <p className="text-xl md:text-2xl font-extrabold text-gray-900">{totalJournals}</p>
            </div>
            <ChevronRight className="w-3 h-3 md:w-4 md:h-4 text-gray-300 group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
          </Link>

          <div className="bg-white p-3 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <div>
              <p className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-wider">Hari Ini</p>
              <p className="text-xs md:text-sm font-extrabold text-gray-900">{currentDayName || '-'}</p>
            </div>
          </div>
        </div>

        {/* Progress Card */}
        <ProgressCard />

        {/* Jadwal Hari Ini */}
        <div className="bg-blue-600 p-4 md:p-6 rounded-2xl md:rounded-3xl shadow-lg text-white space-y-3 md:space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 md:w-5 md:h-5 text-blue-200" />
            <h3 className="text-[10px] md:text-xs font-extrabold uppercase tracking-wider text-blue-100">
              Jadwal Mengajar Hari Ini ({currentDayName})
            </h3>
          </div>

          {todaySchedules.length === 0 ? (
            <div className="p-3 md:p-5 bg-white/10 backdrop-blur-md rounded-xl md:rounded-2xl border border-white/10 text-center space-y-1 md:space-y-2">
              <p className="text-sm md:text-base font-extrabold text-white">
                Tidak ada jadwal mengajar untuk hari {currentDayName}.
              </p>
              <Link
                href="/schedule"
                className="inline-block text-[10px] md:text-xs text-blue-100 underline underline-offset-2"
              >
                Tambahkan lewat menu Jadwal Mengajar
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {todaySchedules.map((sched) => {
                const isOngoing = isScheduleOngoing(sched.timeSlot || sched.time || '');
                return (
                  <div
                    key={sched.id}
                    className={`p-3 md:p-5 rounded-xl md:rounded-2xl flex flex-col justify-between gap-3 md:gap-4 border transition-all ${
                      isOngoing
                        ? 'bg-emerald-500/40 border-emerald-300/40 shadow-lg shadow-emerald-500/20'
                        : 'bg-white/10 border-white/10'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm md:text-base font-extrabold">
                          Kelas {sched.className} • {sched.timeSlot || sched.time}
                        </p>
                        {isOngoing && (
                          <span className="flex items-center gap-1 px-2 py-0.5 md:px-2.5 md:py-1 bg-emerald-400 text-white text-[8px] md:text-[9px] font-extrabold rounded-full shadow-md animate-pulse whitespace-nowrap">
                            <CheckCircle2 className="w-2.5 h-2.5 md:w-3 md:h-3" />
                            Sedang Berlangsung
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] md:text-xs text-blue-100">Mapel: {sched.subject || subject}</p>
                    </div>
                    <Link
                      href="/attendance"
                      className={`self-start px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-[10px] md:text-xs font-bold transition-all shadow-sm ${
                        isOngoing
                          ? 'bg-emerald-400 hover:bg-emerald-300 text-blue-900'
                          : 'bg-white hover:bg-blue-50 text-blue-600'
                      }`}
                    >
                      Mulai Mengajar →
                    </Link>
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
