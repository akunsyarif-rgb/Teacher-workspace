"use client";

import React, { useState, useEffect, useRef } from "react";
import { CheckCircle2, CloudOff, Loader2, AlertCircle, Calendar, UserCheck, History, Trash2, FileDown, PlayCircle, Flag } from "lucide-react";
import Card from "../ui/Card";
import Button from "../ui/Button";
import AttendanceGrid, { TodayEntry } from "./AttendanceGrid";
import ConfirmDeleteModal from "@/src/components/ui/ConfirmDeleteModal";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as attendanceController from "@/lib/controllers/attendanceController";
import * as studentController from "@/lib/controllers/classController";
import { getCached } from "@/lib/utils/sessionCache";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import { useOnlineStatus } from "@/src/hooks/useOnlineStatus";
import { exportAttendanceRecapPdf } from "@/lib/utils/attendancePdf";
import { SkeletonCard, SkeletonTable } from "../ui/Skeleton";

type AttendanceTabProps = {
  className: string;
  subject: string;
  scheduleId?: string | null;
  onSubmitted?: () => void;
};

type AutoSaveState = "idle" | "saving" | "saved" | "error";

export default function AttendanceTab({ className, subject, scheduleId, onSubmitted }: AttendanceTabProps) {
  const { workspaceId } = useWorkspace();
  const isOnline = useOnlineStatus();
  const [statusMap, setStatusMap] = useState<Record<string, TodayEntry>>({});
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [formattedDate, setFormattedDate] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; date: string } | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // Sesi presensi hari ini: null = belum pernah disimpan sama sekali
  // (tombol "Mulai Presensi" masih tampil). Begitu ada, setiap koreksi
  // status siswa meng-update dokumen yang sama (auto-save), bukan bikin
  // dokumen baru. `completed` cuma label progres ("✓ Presensi selesai"),
  // BUKAN kunci — presensi tetap boleh dikoreksi kapan pun sesuai spec.
  const [recordId, setRecordId] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>("idle");
  const [markingDone, setMarkingDone] = useState(false);

  // Ref, bukan cuma state: dibaca di dalam antrean save (lihat
  // triggerAutoSave) supaya penyimpanan berikutnya selalu tahu ID
  // dokumen TERBARU walau state React belum sempat re-render — tanpa ini,
  // dua toggle beruntun sebelum simpanan pertama selesai bisa
  // masing-masing mengira "belum ada dokumen" dan membuat dua dokumen
  // duplikat untuk sesi yang sama.
  const recordIdRef = useRef<string | null>(null);
  // Antrean promise: memaksa setiap auto-save selesai berurutan sesuai
  // urutan toggle, bukan sesuai urutan respons jaringan — tanpa ini,
  // simpanan yang lebih lama tapi lebih lambat direspons bisa menimpa
  // balik simpanan yang lebih baru.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setFormattedDate(
      new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    );
  }, []);

  useEffect(() => {
    if (className && workspaceId) {
      loadAllData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [className, workspaceId, scheduleId]);

  async function loadAllData() {
    // Data kelas ini mungkin sudah hangat di sessionCache (dipakai semua
    // tab, TTL 60 detik) — kalau iya, jangan nyalakan skeleton loading:
    // guru yang gonta-ganti kelas/tab berulang dalam waktu singkat langsung
    // lihat data lama tanpa kedipan "memuat" padahal tidak ada request baru.
    const alreadyWarm =
      !!workspaceId &&
      getCached(studentController.studentsInClassCacheKey(workspaceId, className)) !== undefined &&
      getCached(attendanceController.attendanceHistoryCacheKey(workspaceId, className)) !== undefined;

    if (!alreadyWarm) {
      setLoadingData(true);
    }
    await Promise.all([loadStudentsAndTodaySession(), loadHistory()]);
    setLoadingData(false);
  }

  async function loadStudentsAndTodaySession() {
    if (!workspaceId || !className) return;
    try {
      const list = await studentController.fetchStudentsInClass(workspaceId, className);
      setStudents(list);
      const initial: Record<string, TodayEntry> = {};
      list.forEach((s: any) => {
        initial[s.id] = { status: "Hadir", late: false };
      });

      const todayRecord = await attendanceController.fetchTodayAttendance(workspaceId, className, scheduleId);
      if (todayRecord) {
        (todayRecord.details || []).forEach((d: any) => {
          if (initial[d.studentId]) {
            initial[d.studentId] = { status: d.status, late: !!d.late };
          }
        });
        recordIdRef.current = todayRecord.id;
        setRecordId(todayRecord.id);
        setCompleted(!!todayRecord.completed);
      } else {
        recordIdRef.current = null;
        setRecordId(null);
        setCompleted(false);
      }
      setAutoSaveState("idle");
      setStatusMap(initial);
    } catch (error) {
      console.error("Gagal memuat siswa/sesi presensi hari ini:", error);
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

  function triggerAutoSave(nextStatusMap: Record<string, TodayEntry>) {
    if (!workspaceId) return;
    setAutoSaveState("saving");
    setErrorMsg("");
    saveQueueRef.current = saveQueueRef.current
      .then(() =>
        attendanceController.autoSaveAttendanceRecord(
          recordIdRef.current,
          workspaceId,
          className,
          subject,
          students,
          nextStatusMap,
          scheduleId
        )
      )
      .then((id) => {
        recordIdRef.current = id;
        setRecordId(id);
        setAutoSaveState("saved");
        loadHistory();
        onSubmitted?.();
      })
      .catch((error: any) => {
        console.error("Gagal auto-save presensi:", error);
        setAutoSaveState("error");
        setErrorMsg(error?.message || "Gagal menyimpan presensi otomatis.");
      });
  }

  function handleEntryChange(studentId: string, next: TodayEntry) {
    setStatusMap((prev) => {
      const updated = { ...prev, [studentId]: next };
      triggerAutoSave(updated);
      return updated;
    });
  }

  function handleSetAllHadir() {
    const updated: Record<string, TodayEntry> = {};
    students.forEach((s) => {
      updated[s.id] = { status: "Hadir", late: false };
    });
    setStatusMap(updated);
    triggerAutoSave(updated);
  }

  async function handleMarkCompleted() {
    if (!recordId) return;
    setMarkingDone(true);
    try {
      await attendanceController.markAttendanceCompleted(recordId);
      setCompleted(true);
    } catch (error: any) {
      setErrorMsg(error.message || "Gagal menandai presensi selesai.");
    } finally {
      setMarkingDone(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await attendanceController.deleteAttendanceRecord(deleteTarget.id);
    if (deleteTarget.id === recordId) {
      recordIdRef.current = null;
      setRecordId(null);
      setCompleted(false);
    }
    await loadHistory();
    setDeleteTarget(null);
  }

  function handleExportPdf() {
    exportAttendanceRecapPdf({ className, subject, students, history });
  }

  return (
    <div className="space-y-6">
      <InlineAlert message={errorMsg} onDismiss={() => setErrorMsg("")} />

      <div className="space-y-6">
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

        <Card className="space-y-4 !p-3 sm:!p-4">
          <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-blue-600" />
              Daftar Absen ({loadingData ? '...' : students.length} Siswa)
            </h3>

            {/* Status auto-save — jelas terlihat, sesuai prinsip "Status
                tersimpan ditampilkan jelas". Cuma tampil begitu sesi sudah
                mulai (recordId ada), supaya sebelum itu tidak menyesatkan
                seolah-olah sudah ada yang tersimpan. */}
            {recordId && !loadingData && (
              <span className="flex items-center gap-1.5 text-[11px] font-bold">
                {autoSaveState === "saving" && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />
                    <span className="text-gray-400">Menyimpan...</span>
                  </>
                )}
                {autoSaveState === "saved" && isOnline && (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600">Tersimpan otomatis</span>
                  </>
                )}
                {autoSaveState === "saved" && !isOnline && (
                  <>
                    <CloudOff className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-amber-600">Tersimpan offline — akan tersinkron</span>
                  </>
                )}
                {autoSaveState === "error" && (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                    <span className="text-red-600">Gagal menyimpan</span>
                  </>
                )}
              </span>
            )}
          </div>

          {loadingData ? (
            <div className="py-4">
              <SkeletonTable rows={3} cols={2} />
            </div>
          ) : students.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-12">Belum ada siswa di kelas ini.</p>
          ) : (
            <AttendanceGrid students={students} history={history} statusMap={statusMap} onChange={handleEntryChange} />
          )}
        </Card>

        {students.length > 0 && !loadingData && (
          <>
            {!recordId ? (
              <Button onClick={() => triggerAutoSave(statusMap)} loading={autoSaveState === "saving"}>
                <PlayCircle className="w-5 h-5" />
                <span>{autoSaveState === "saving" ? "Memulai..." : "Mulai Presensi"}</span>
              </Button>
            ) : completed ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2 text-sm font-bold text-emerald-700">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span>Presensi selesai — status masih bisa dikoreksi kapan saja kalau ada kesalahan.</span>
              </div>
            ) : (
              <Button onClick={handleMarkCompleted} loading={markingDone} variant="secondary">
                <Flag className="w-5 h-5" />
                <span>{markingDone ? "Menandai..." : "Tandai Presensi Selesai"}</span>
              </Button>
            )}
          </>
        )}
      </div>

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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                      {item.date}
                    </span>
                    <span className="text-xs font-bold text-gray-900">• {item.subject}</span>
                    {item.completed && (
                      <span className="flex items-center gap-1 text-[10px] font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                        <CheckCircle2 className="w-3 h-3" />
                        Selesai
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1 text-[11px] font-semibold">
                    <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">Hadir: {item.summary?.hadir || 0}</span>
                    {(item.summary?.terlambat || 0) > 0 && (
                      <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded">
                        (Terlambat: {item.summary.terlambat})
                      </span>
                    )}
                    <span className="text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded">Sakit: {item.summary?.sakit || 0}</span>
                    <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded">Izin: {item.summary?.izin || 0}</span>
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
