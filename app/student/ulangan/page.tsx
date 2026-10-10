"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";
import InlineAlert from "@/src/components/ui/InlineAlert";
import { SkeletonCard } from "@/src/components/ui/Skeleton";
import * as ulangan from "@/lib/controllers/ulanganController";
import { isUlanganEnabled } from "@/lib/config/ulangan";
import type { StudentExam } from "@/lib/types/ulangan";

const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Makassar", dateStyle: "medium", timeStyle: "short" });

function List() {
  const router = useRouter();
  const [exams, setExams] = useState<StudentExam[] | null>(null);
  const [serverNow, setServerNow] = useState<number>(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let off = false;
    ulangan.fetchMyExams()
      .then((r) => { if (!off) { setExams(r.exams); setServerNow(Date.parse(r.serverNow)); } })
      .catch((e) => { if (!off) { setError(ulangan.describeError(e)); setExams([]); } });
    return () => { off = true; };
  }, []);

  async function open(exam: StudentExam) {
    setBusy(exam.id); setError("");
    try {
      const a = await ulangan.beginAttempt(exam.id); // idempoten; juga memulihkan pengerjaan aktif dari perangkat/sesi baru
      router.push(`/student/ulangan/${a.id}`);
    } catch (e) { setError(ulangan.describeError(e)); setBusy(""); }
  }

  if (!exams) return <SkeletonCard />;
  return (
    <div className="space-y-3">
      <InlineAlert message={error} onDismiss={() => setError("")} />
      {exams.length === 0 && <p className="text-xs text-gray-500 text-center py-10">Belum ada ulangan untuk kelasmu.</p>}
      {exams.map((e) => {
        const opens = Date.parse(e.opensAt);
        const closes = Date.parse(e.closesAt);
        const state = e.attempt?.status === "active" ? "lanjut" : e.attempt ? "selesai" : e.status !== "published" || serverNow >= closes ? "tutup" : serverNow < opens ? "belum" : "mulai";
        return (
          <div key={e.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-2">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><ClipboardCheck className="w-4 h-4" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-extrabold text-gray-900">{e.title}</p>
                <p className="text-[10px] text-gray-500">{e.subject ? `${e.subject} · ` : ""}{e.durationMinutes} menit · {fmt(e.opensAt)} – {fmt(e.closesAt)}</p>
              </div>
            </div>
            {e.attempt?.result && (
              <p className="text-xs font-bold text-emerald-600">Nilai: {e.attempt.result.score} ({e.attempt.result.correctCount}/{e.attempt.result.maxScore} poin benar)</p>
            )}
            {state === "selesai" && !e.attempt?.result && <p className="text-xs font-bold text-gray-500">Sudah dikumpulkan.</p>}
            {state === "belum" && <p className="text-xs font-bold text-amber-600">Belum dibuka.</p>}
            {state === "tutup" && <p className="text-xs font-bold text-gray-400">Sudah ditutup.</p>}
            {(state === "mulai" || state === "lanjut") && (
              <button type="button" disabled={busy === e.id} onClick={() => open(e)}
                className="w-full py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white disabled:bg-blue-300 active:scale-[0.97]">
                {busy === e.id ? "Membuka..." : state === "lanjut" ? "Lanjutkan" : "Mulai Ulangan"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function StudentUlanganPage() {
  return (
    <StudentShell title="Ulangan" subtitle="Ulangan harian kelasmu">
      {() => (isUlanganEnabled() ? <List /> : <p className="text-xs text-gray-500 text-center py-10">Fitur ulangan belum diaktifkan.</p>)}
    </StudentShell>
  );
}
