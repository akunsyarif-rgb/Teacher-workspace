"use client";

import React, { useEffect, useState } from "react";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as ulangan from "@/lib/controllers/ulanganController";
import type { IntegrityEventRow, MonitorView } from "@/lib/types/ulangan";

const STATUS: Record<string, string> = { not_started: "Belum mulai", active: "Mengerjakan", submitted: "Selesai", expired: "Waktu habis" };
const LEVEL: Record<number, string> = { 0: "", 1: "Peringatan 1", 2: "Peringatan 2", 3: "Peringatan 3" };

export default function ExamMonitor({ examId, onClose }: { examId: string; onClose: () => void }) {
  const [view, setView] = useState<MonitorView | null>(null);
  const [events, setEvents] = useState<{ name: string; rows: IntegrityEventRow[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let off = false;
    const load = () => ulangan.fetchExamResults(examId)
      .then((v) => { if (!off) setView(v); })
      .catch((e) => { if (!off) setError(ulangan.describeError(e)); });
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => { off = true; clearInterval(t); };
  }, [examId]);

  async function showEvents(attemptId: string, name: string) {
    try { setEvents({ name, rows: await ulangan.fetchAttemptEvents(attemptId) }); } catch (e) { setError(ulangan.describeError(e)); }
  }

  if (!view) return <InlineAlert message={error || "Memuat..."} />;
  const s = view.summary;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-extrabold">{view.exam.title}</p>
        <button type="button" onClick={onClose} className="text-xs font-bold text-blue-600 px-2 py-2">Tutup</button>
      </div>
      <InlineAlert message={error} onDismiss={() => setError("")} />
      <p className="text-[11px] text-gray-600">{s.started}/{s.assigned} mulai · {s.submitted} selesai{s.avgScore !== null ? ` · rata-rata ${s.avgScore} (min ${s.minScore}, maks ${s.maxScore})` : ""}</p>
      <p className="text-[10px] text-gray-400">Sinyal integritas hanyalah indikasi (mis. berpindah tab/aplikasi), bukan bukti kecurangan. Tidak ada sanksi otomatis; tinjau konteksnya.</p>
      <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100">
        <table className="w-full text-[11px]">
          <thead><tr className="text-left text-gray-500"><th className="p-2">Siswa</th><th>Kelas</th><th>Status</th><th>Terjawab</th><th>Nilai</th><th>Integritas</th></tr></thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.studentId} className="border-t border-gray-50">
                <td className="p-2 font-bold">{r.name}</td><td>{r.className}</td><td>{STATUS[r.status]}</td>
                <td>{r.attemptId ? `${r.answeredCount}/${r.totalQuestions}` : "-"}</td>
                <td>{r.score ?? "-"}</td>
                <td>
                  {r.attemptId && r.leaveCount > 0 ? (
                    <button type="button" className={`underline ${r.maxWarningLevel >= 3 ? "text-red-600" : r.maxWarningLevel === 2 ? "text-amber-600" : "text-gray-600"}`} onClick={() => showEvents(r.attemptId as string, r.name)}>
                      {r.leaveCount}× keluar halaman ({LEVEL[r.maxWarningLevel]})
                    </button>
                  ) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events && (
        <div className="bg-white p-3 rounded-2xl border border-gray-100 space-y-1">
          <p className="text-xs font-extrabold">Kejadian: {events.name}</p>
          {events.rows.map((e) => (
            <p key={e.id} className="text-[11px] text-gray-700">
              {new Date(e.occurredAt).toLocaleTimeString("id-ID", { timeZone: "Asia/Makassar" })} · {e.eventType}{e.durationMs ? ` · ${Math.round(e.durationMs / 1000)} dtk` : ""} · {e.severity}
            </p>
          ))}
          <button type="button" onClick={() => setEvents(null)} className="text-[11px] font-bold text-blue-600 py-1">Tutup</button>
        </div>
      )}
    </div>
  );
}
