"use client";

import React, { useState, useEffect } from "react";
import { CheckCircle2, CloudOff, Calendar, UserCheck, History, Trash2, FileDown } from "lucide-react";
import Card from "../ui/Card";
import Button from "../ui/Button";
import StudentAttendanceRow from "./StudentAttendanceRow";
import ConfirmDeleteModal from "@/src/components/ui/ConfirmDeleteModal";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as attendanceController from "@/lib/controllers/attendanceController";
import * as studentController from "@/lib/controllers/classController";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import { useOnlineStatus } from "@/src/hooks/useOnlineStatus";
import { exportAttendanceRecapPdf } from "@/lib/utils/attendancePdf";
import { SkeletonText, SkeletonCard, SkeletonTable } from "../ui/Skeleton";

type AttendanceTabProps = {
  className: string;
  subject: string;
  scheduleId?: string | null;
  onSubmitted?: () => void;
};

export default function AttendanceTab({ className, subject, scheduleId, onSubmitted }: AttendanceTabProps) {
  const { workspaceId } = useWorkspace();
  const isOnline = useOnlineStatus();
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [formattedDate, setFormattedDate] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; date: string } | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    setFormattedDate(
      new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    );
  }, []);

  useEffect(() => {
    if (className && workspaceId) {
      loadAllData();
    }
  }, [className, workspaceId]);

  async function loadAllData() {
    setLoadingData(true);
    await Promise.all([loadStudents(), loadHistory()]);
    setLoadingData(false);
  }

  async function loadStudents() {
    if (!workspaceId || !className) return;
    try {
      const list = await studentController.fetchStudentsInClass(workspaceId, className);
      setStudents(list);
      const initial: Record<string, string> = {};
      list.forEach((s: any) => {
        initial[s.id] = "Hadir";
      });
      setStatusMap(initial);
    } catch (error) {
      console.error("Gagal memuat siswa:", error);
    }
  }

  async function loadHistory() {
    if (!className || !workspaceId) return;
    try {
      const entries = await attendanceController.fetchAttendanceHistory(workspaceId, className);
      setHistory(entries);
    } catch (error) {
      console.error("Gagal memuat riwayat presensi:", error);
    }
  }

  // Strip riwayat singkat per siswa — dirakit dari sesi presensi yang
  // sudah tersimpan (history), bukan data/kolom baru. Membantu guru melihat
  // pola kehadiran tanpa mengubah cara mengisi presensi hari ini.
  function getRecentHistory(studentId: string, limit = 5): { date: string; status: string }[] {
    const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const result: { date: string; status: string }[] = [];
    sorted.forEach((session) => {
      const detail = (session.details || []).find((d: any) => d.studentId === studentId);
      if (detail) result.push({ date: session.date, status: detail.status });
    });
    return result.slice(-limit);
  }

  function handleStatusChange(studentId: string, status: string) {
    setStatusMap((prev) => ({ ...prev, [studentId]: status }));
  }

  function handleSetAllHadir() {
    const updated: Record<string, string> = {};
    students.forEach((s) => {
      updated[s.id] = "Hadir";
    });
    setStatusMap(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setLoading(true);
    setSuccess(false);
    setErrorMsg("");
    try {
      await attendanceController.submitAttendanceRecord(
        workspaceId,
        className,
        subject,
        students,
        statusMap,
        scheduleId
      );
      setSuccess(true);
      await loadHistory();
      onSubmitted?.();
    } catch (error: any) {
      setErrorMsg(error.message || "Gagal menyimpan presensi.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await attendanceController.deleteAttendanceRecord(deleteTarget.id);
    await loadHistory();
    setDeleteTarget(null);
  }

  function handleExportPdf() {
    exportAttendanceRecapPdf({ className, subject, students, history });
  }

  return (
    <div className="space-y-6">
      <InlineAlert message={errorMsg} onDismiss={() => setErrorMsg("")} />
      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          {isOnline ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Presensi Kelas {className} berhasil disimpan!</span>
            </>
          ) : (
            <>
              <CloudOff className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Presensi tersimpan offline — akan tersinkron otomatis saat koneksi kembali.</span>
            </>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Tanggal Hari Ini</label>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span>{formattedDate || "Memuat tanggal..."}</span>
            </div>
          </div>

          {students.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-100">
              <span className="text-xs font-bold text-gray-500">Pintasan Cepat:</span>
              <button
                type="button"
                onClick={handleSetAllHadir}
                className="px-4 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                Set Semua Hadir
              </button>
            </div>
          )}
        </Card>

        <Card className="space-y-4">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-blue-600" />
            Daftar Absen ({loadingData ? '...' : students.length} Siswa)
          </h3>

          {loadingData ? (
            <div className="py-4">
              <SkeletonTable rows={3} cols={2} />
            </div>
          ) : students.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-12">Belum ada siswa di kelas ini.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {students.map((student, idx) => (
                <StudentAttendanceRow
                  key={student.id}
                  student={student}
                  index={idx}
                  status={statusMap[student.id] || "Hadir"}
                  onStatusChange={handleStatusChange}
                  recentHistory={getRecentHistory(student.id)}
                />
              ))}
            </div>
          )}
        </Card>

        {students.length > 0 && !loadingData && (
          <Button type="submit" loading={loading}>
            <CheckCircle2 className="w-5 h-5" />
            <span>{loading ? "Menyimpan Presensi..." : "Simpan Presensi Kelas"}</span>
          </Button>
        )}
      </form>

      {/* Riwayat dengan Skeleton */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <History className="w-4 h-4 text-blue-600" />
            Riwayat Presensi ({loadingData ? '...' : history.length} Sesi)
          </h3>
          {!loadingData && history.length > 0 && (
            <button
              type="button"
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-[11px] font-bold transition-colors"
            >
              <FileDown className="w-3.5 h-3.5" />
              Export PDF Rekap
            </button>
          )}
        </div>

        {loadingData ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-gray-400 py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            Belum ada rekap presensi untuk kelas ini.
          </p>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <div
                key={item.id}
                className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                      {item.date}
                    </span>
                    <span className="text-xs font-bold text-gray-900">• {item.subject}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1 text-[11px] font-semibold">
                    <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded">Hadir: {item.summary?.hadir || 0}</span>
                    {(item.summary?.terlambat || 0) > 0 && (
                      <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded">
                        (Terlambat: {item.summary.terlambat})
                      </span>
                    )}
                    <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded">Sakit: {item.summary?.sakit || 0}</span>
                    <span className="text-purple-600 bg-purple-50 px-2 py-0.5 rounded">Izin: {item.summary?.izin || 0}</span>
                    <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded">Alpa: {item.summary?.alpa || 0}</span>
                  </div>
                </div>
                <button
                  onClick={() => setDeleteTarget({ id: item.id, date: item.date })}
                  className="p-3.5 text-red-500 hover:bg-red-50 rounded-xl transition-colors active:scale-90 self-end md:self-auto"
                  title="Hapus Rekap Presensi"
                  aria-label="Hapus Rekap Presensi"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Hapus Rekap Presensi?"
        itemName={`Presensi ${deleteTarget?.date || ""}`}
        itemDetail={`Kelas ${className}`}
        requireTyping={false}
        type="warning"
      />
    </div>
  );
}
