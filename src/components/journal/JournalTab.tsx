"use client";

import React, { useState, useEffect, MutableRefObject } from "react";
import { CheckCircle2, CloudOff, Calendar, Circle, Pencil, X } from "lucide-react";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import Button from "../ui/Button";
import Card from "../ui/Card";
import JournalHistoryList from "./JournalHistoryList";
import ConfirmDeleteModal from "@/src/components/ui/ConfirmDeleteModal";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as journalController from "@/lib/controllers/journalController";
import { getCached } from "@/lib/utils/sessionCache";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import { useOnlineStatus } from "@/src/hooks/useOnlineStatus";
import { SkeletonText, SkeletonCard } from "../ui/Skeleton";

type JournalTabProps = {
  className: string;
  subject: string;
  scheduleId?: string | null;
  onSubmitted?: () => void;
  // Dipakai AttendanceForm untuk exit guard "Unsaved Changes": true kalau
  // sedang mode edit dengan isi berbeda dari yang tersimpan terakhir.
  onDirtyChange?: (dirty: boolean) => void;
  // AttendanceForm menaruh fungsi save ke ref ini supaya tombol "Simpan &
  // Keluar" di dialog Unsaved Changes bisa memicu simpan jurnal yang
  // sesungguhnya (bukan cuma menutup tab begitu saja).
  saveHandleRef?: MutableRefObject<(() => Promise<void>) | null>;
};

export default function JournalTab({
  className,
  subject,
  scheduleId,
  onSubmitted,
  onDirtyChange,
  saveHandleRef,
}: JournalTabProps) {
  const { workspaceId } = useWorkspace();
  const isOnline = useOnlineStatus();
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [formattedDate, setFormattedDate] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; topic: string } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingToday, setLoadingToday] = useState(true);

  // Jurnal hari ini: null = belum pernah diisi ("○ Belum diisi", form
  // langsung terbuka). Begitu tersimpan, tampilan berubah ke mode ringkas
  // ("✓ Tersimpan") dengan tombol Edit — bukan form kosong lagi, supaya
  // jelas jurnal SUDAH ada dan guru tidak menulis dobel tanpa sadar.
  const [todayEntryId, setTodayEntryId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("edit");
  const [savedTopic, setSavedTopic] = useState("");
  const [savedNotes, setSavedNotes] = useState("");

  useEffect(() => {
    setFormattedDate(
      new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    );
  }, []);

  useEffect(() => {
    if (className && workspaceId) {
      loadHistory();
      loadTodayEntry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [className, workspaceId, scheduleId]);

  async function loadTodayEntry() {
    if (!className || !workspaceId) return;
    setLoadingToday(true);
    try {
      const entry = await journalController.fetchTodayJournal(workspaceId, className, scheduleId);
      if (entry) {
        setTodayEntryId(entry.id);
        setSavedTopic(entry.topic || "");
        setSavedNotes(entry.notes || "");
        setTopic(entry.topic || "");
        setNotes(entry.notes || "");
        setMode("view");
      } else {
        setTodayEntryId(null);
        setSavedTopic("");
        setSavedNotes("");
        setTopic("");
        setNotes("");
        setMode("edit");
      }
    } catch (error) {
      console.error("Gagal memuat jurnal hari ini:", error);
    } finally {
      setLoadingToday(false);
    }
  }

  async function loadHistory() {
    if (!className || !workspaceId) return;
    const alreadyWarm = getCached(journalController.journalHistoryCacheKey(workspaceId, className)) !== undefined;
    if (!alreadyWarm) {
      setLoadingHistory(true);
    }
    try {
      const entries = await journalController.fetchJournalHistory(workspaceId, className);
      setHistory(entries);
    } catch (error) {
      console.error("Gagal memuat riwayat jurnal:", error);
    } finally {
      setLoadingHistory(false);
    }
  }

  function handleStartEdit() {
    setTopic(savedTopic);
    setNotes(savedNotes);
    setSuccess(false);
    setMode("edit");
  }

  function handleCancelEdit() {
    setTopic(savedTopic);
    setNotes(savedNotes);
    setMode("view");
  }

  async function doSubmit() {
    if (!workspaceId || !topic.trim()) return;
    setLoading(true);
    setSuccess(false);
    setErrorMsg("");
    try {
      const result = await journalController.submitJournalEntry(
        todayEntryId,
        workspaceId,
        className,
        subject,
        { topic, notes },
        scheduleId
      );
      setSuccess(true);
      setTodayEntryId(result.id);
      setSavedTopic(topic.trim());
      setSavedNotes(notes.trim() || "-");
      setMode("view");
      await loadHistory();
      onSubmitted?.();
    } catch (error: any) {
      setErrorMsg(error.message || "Gagal menyimpan jurnal.");
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doSubmit().catch(() => {});
  }

  // Sinyal "ada perubahan belum tersimpan" ke AttendanceForm — hanya di
  // mode edit dan hanya kalau isinya benar-benar beda dari yang tersimpan
  // (mode "view" tidak pernah dianggap dirty karena isinya persis salinan
  // savedTopic/savedNotes).
  useEffect(() => {
    const dirty = mode === "edit" && (topic.trim() !== savedTopic.trim() || notes.trim() !== (savedNotes === "-" ? "" : savedNotes.trim()));
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, topic, notes, savedTopic, savedNotes]);

  useEffect(() => {
    if (!saveHandleRef) return;
    saveHandleRef.current = doSubmit;
    return () => {
      if (saveHandleRef.current === doSubmit) saveHandleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    await journalController.deleteJournalEntry(deleteTarget.id);
    if (deleteTarget.id === todayEntryId) {
      setTodayEntryId(null);
      setSavedTopic("");
      setSavedNotes("");
      setTopic("");
      setNotes("");
      setMode("edit");
    }
    await loadHistory();
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-6">
      <InlineAlert message={errorMsg} onDismiss={() => setErrorMsg("")} />
      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          {isOnline ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Jurnal Mengajar Kelas {className} berhasil disimpan!</span>
            </>
          ) : (
            <>
              <CloudOff className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Jurnal tersimpan offline — akan tersinkron otomatis saat koneksi kembali.</span>
            </>
          )}
        </div>
      )}

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="text-xs font-bold text-gray-700">Tanggal Mengajar</label>
          {!loadingToday && (
            <span className="flex items-center gap-1.5 text-[11px] font-bold">
              {todayEntryId ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-600">Tersimpan</span>
                </>
              ) : (
                <>
                  <Circle className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-gray-400">Belum diisi</span>
                </>
              )}
            </span>
          )}
        </div>
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span>{formattedDate || "Memuat tanggal..."}</span>
        </div>
      </Card>

      {mode === "view" ? (
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-gray-900">{savedTopic}</h3>
            <button
              type="button"
              onClick={handleStartEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-[11px] font-bold transition-colors shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Jurnal
            </button>
          </div>
          {savedNotes && savedNotes !== "-" && <p className="text-xs text-gray-500">{savedNotes}</p>}
          <p className="text-[11px] text-gray-400">
            Jurnal hari ini sudah tersimpan. Bisa diperbaiki kapan saja lewat tombol Edit.
          </p>
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="space-y-4">
            <Input
              label="Materi / Topik Pembelajaran"
              value={topic}
              onChange={setTopic}
              placeholder="Contoh: Memahami Hukum Tajwid"
              required
            />
            <Textarea
              label="Catatan Kegiatan / Hambatan (Opsional)"
              value={notes}
              onChange={setNotes}
              placeholder="Catat aktivitas atau kendala selama KBM..."
              rows={4}
            />
          </Card>
          <div className="flex gap-2">
            <Button type="submit" loading={loading}>
              <CheckCircle2 className="w-5 h-5" />
              <span>{loading ? "Menyimpan Jurnal..." : todayEntryId ? "Simpan Perubahan" : "Simpan Jurnal Mengajar"}</span>
            </Button>
            {todayEntryId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="shrink-0 px-4 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-2xl transition-colors"
                title="Batal"
                aria-label="Batal"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </form>
      )}

      {/* Riwayat dengan Skeleton */}
      {loadingHistory ? (
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-200 rounded animate-pulse" />
            <SkeletonText lines={1} className="w-32" />
          </div>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <JournalHistoryList
          entries={history}
          onDelete={(id) => {
            const entry = history.find(h => h.id === id);
            if (entry) setDeleteTarget({ id, topic: entry.topic });
          }}
        />
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Hapus Catatan Jurnal?"
        itemName={deleteTarget?.topic || ""}
        itemDetail={`Kelas ${className}`}
        requireTyping={false}
        type="warning"
      />
    </div>
  );
}
