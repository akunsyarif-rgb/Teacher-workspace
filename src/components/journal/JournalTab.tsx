"use client";

import React, { useState, useEffect } from "react";
import { CheckCircle2, CloudOff, Calendar } from "lucide-react";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import Button from "../ui/Button";
import Card from "../ui/Card";
import JournalHistoryList from "./JournalHistoryList";
import ConfirmDeleteModal from "@/src/components/ui/ConfirmDeleteModal";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as journalController from "@/lib/controllers/journalController";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import { useOnlineStatus } from "@/src/hooks/useOnlineStatus";
import { SkeletonText, SkeletonCard } from "../ui/Skeleton";

type JournalTabProps = {
  className: string;
  subject: string;
  scheduleId?: string | null;
  onSubmitted?: () => void;
};

export default function JournalTab({ className, subject, scheduleId, onSubmitted }: JournalTabProps) {
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

  useEffect(() => {
    setFormattedDate(
      new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    );
  }, []);

  useEffect(() => {
    if (className && workspaceId) loadHistory();
  }, [className, workspaceId]);

  async function loadHistory() {
    if (!className || !workspaceId) return;
    setLoadingHistory(true);
    try {
      const entries = await journalController.fetchJournalHistory(workspaceId, className);
      setHistory(entries);
    } catch (error) {
      console.error("Gagal memuat riwayat jurnal:", error);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setLoading(true);
    setSuccess(false);
    setErrorMsg("");
    try {
      await journalController.submitJournalEntry(workspaceId, className, subject, { topic, notes }, scheduleId);
      setSuccess(true);
      setTopic("");
      setNotes("");
      await loadHistory();
      onSubmitted?.();
    } catch (error: any) {
      setErrorMsg(error.message || "Gagal menyimpan jurnal.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await journalController.deleteJournalEntry(deleteTarget.id);
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

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Tanggal Mengajar</label>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span>{formattedDate || "Memuat tanggal..."}</span>
            </div>
          </div>
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
        <Button type="submit" loading={loading}>
          <CheckCircle2 className="w-5 h-5" />
          <span>{loading ? "Menyimpan Jurnal..." : "Simpan Jurnal Mengajar"}</span>
        </Button>
      </form>

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
