"use client";

import React, { useState, useEffect } from "react";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import { fetchDashboardSummary } from "@/lib/controllers/dashboardController";
import { fetchInsights } from "@/lib/controllers/analyticsController";
import WeeklyChart from "@/src/components/ui/WeeklyChart";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  BookOpen,
  Users,
  AlertTriangle,
  ClipboardList,
  UserX,
  FileWarning,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { SkeletonCard } from "@/src/components/ui/Skeleton";

const CATEGORY_STYLE: Record<string, { icon: any; label: string; tone: string }> = {
  kehadiran: { icon: UserX, label: "Kehadiran", tone: "bg-amber-50 text-amber-700" },
  tugas: { icon: ClipboardList, label: "Tugas", tone: "bg-blue-50 text-blue-700" },
  administrasi: { icon: FileWarning, label: "Administrasi", tone: "bg-violet-50 text-violet-700" },
};

export default function AnalyticsPage() {
  const { workspaceId } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [weeklyStats, setWeeklyStats] = useState<{
    days: string[];
    journalCounts: number[];
    attendanceCounts: number[];
  }>({ days: [], journalCounts: [], attendanceCounts: [] });
  const [totalJournals, setTotalJournals] = useState(0);
  const [uniqueClasses, setUniqueClasses] = useState<string[]>([]);
  const [insights, setInsights] = useState<any[]>([]);
  const [windowDays, setWindowDays] = useState(30);

  useEffect(() => {
    if (workspaceId) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [workspaceId]);

  async function loadData() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [summary, insightResult] = await Promise.all([
        fetchDashboardSummary(workspaceId),
        fetchInsights(workspaceId),
      ]);
      setWeeklyStats(summary.weeklyStats);
      setTotalJournals(summary.totalJournals);
      setUniqueClasses(summary.uniqueClasses);
      setInsights(insightResult.insights);
      setWindowDays(insightResult.windowDays);
    } catch (err) {
      console.error("Gagal memuat data statistik:", err);
    } finally {
      setLoading(false);
    }
  }

  const urgentCount = insights.filter((i) => i.severity === "tinggi").length;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-blue-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali ke Beranda
          </Link>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-extrabold text-gray-900">Statistik & Analitik</h1>
          </div>
        </div>

        {/* Temuan ditaruh PALING ATAS, sebelum grafik: yang dicari guru
            adalah "apa yang perlu saya lakukan", bukan angka mentah. */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-extrabold text-gray-900">Perlu Tindakan</h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              {windowDays} hari terakhir
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : insights.length === 0 ? (
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-xs font-bold text-gray-700">Tidak ada yang perlu ditindaklanjuti.</p>
              <p className="text-[11px] text-gray-500">
                Kehadiran, pengumpulan tugas, dan jurnal semuanya dalam batas wajar.
              </p>
            </div>
          ) : (
            <>
              {urgentCount > 0 && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <p className="text-[11px] font-bold text-red-700">
                    {urgentCount} temuan mendesak dari total {insights.length}.
                  </p>
                </div>
              )}

              {insights.map((insight) => {
                const style = CATEGORY_STYLE[insight.category] || CATEGORY_STYLE.administrasi;
                const Icon = style.icon;
                return (
                  <div
                    key={insight.id}
                    className={`bg-white p-4 rounded-2xl border shadow-sm space-y-2.5 ${
                      insight.severity === "tinggi" ? "border-red-200" : "border-gray-100"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${style.tone}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider ${style.tone}`}>
                            {style.label}
                          </span>
                          {insight.severity === "tinggi" && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-red-50 text-red-700">
                              Mendesak
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-gray-900">{insight.title}</p>
                        <p className="text-[11px] text-gray-500">{insight.detail}</p>
                      </div>
                    </div>

                    <div className="pl-11 space-y-2">
                      <p className="text-[11px] text-gray-700">
                        <span className="font-bold">Saran: </span>
                        {insight.recommendation}
                      </p>
                      <Link
                        href={insight.href}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline"
                      >
                        Kerjakan sekarang
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Ringkasan */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Jurnal</p>
              <p className="text-2xl font-extrabold text-gray-900">{totalJournals}</p>
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Kelas Diampu</p>
              <p className="text-2xl font-extrabold text-gray-900">{uniqueClasses.length}</p>
            </div>
          </div>
        </div>

        {/* Grafik Mingguan */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            <h3 className="text-sm font-extrabold text-gray-700 uppercase tracking-wider">
              Aktivitas 7 Hari Terakhir
            </h3>
          </div>
          {weeklyStats.days.length > 0 ? (
            <>
              <WeeklyChart
                labels={weeklyStats.days}
                journalData={weeklyStats.journalCounts}
                attendanceData={weeklyStats.attendanceCounts}
              />
              <p className="text-[10px] text-gray-400 text-center">Jumlah jurnal dan presensi per hari</p>
            </>
          ) : (
            <p className="text-xs text-gray-500 text-center py-8">
              Belum ada data. Mulai isi jurnal dan presensi untuk melihat grafik.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
