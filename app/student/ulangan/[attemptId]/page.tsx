"use client";

import React, { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as ulangan from "@/lib/controllers/ulanganController";
import type { AttemptView } from "@/lib/types/ulangan";

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function Exam({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const [view, setView] = useState<AttemptView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [unsaved, setUnsaved] = useState(0);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const deadline = useRef(0); // ms epoch lokal = waktu terima + sisa detik dari SERVER (jam perangkat tidak dipercaya untuk keputusan)
  const pending = useRef(new Map<string, string>());
  const flushing = useRef(false);
  const active = view?.attempt.status === "active";

  const apply = useCallback((v: AttemptView) => {
    deadline.current = Date.now() + v.attempt.remainingSeconds * 1000;
    setView(v);
    setAnswers({ ...v.answers, ...Object.fromEntries(pending.current) });
  }, []);
  const load = useCallback(
    () => ulangan.fetchAttempt(attemptId).then(apply).catch((e) => setError(ulangan.describeError(e))),
    [attemptId, apply]
  );
  useEffect(() => {
    let off = false;
    ulangan.fetchAttempt(attemptId)
      .then((v) => { if (!off) apply(v); })
      .catch((e) => { if (!off) setError(ulangan.describeError(e)); });
    return () => { off = true; };
  }, [attemptId, apply]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const [qid, oid] of [...pending.current]) {
        try {
          await ulangan.answerQuestion(attemptId, qid, oid);
          if (pending.current.get(qid) === oid) pending.current.delete(qid);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (/attempt_expired|attempt_not_active/.test(msg)) { pending.current.clear(); await load(); break; }
          break; // jaringan/sementara: dicoba lagi oleh interval
        }
      }
    } finally { flushing.current = false; setUnsaved(pending.current.size); }
  }, [attemptId, load]);

  useEffect(() => { if (!active) return; const t = setInterval(() => void flush(), 5000); return () => clearInterval(t); }, [active, flush]);

  const finish = useCallback(async () => {
    setFinishing(true); setError("");
    try { await flush(); await ulangan.finishAttempt(attemptId); pending.current.clear(); await load(); }
    catch (e) { setError(ulangan.describeError(e)); }
    finally { setFinishing(false); setConfirmSubmit(false); }
  }, [attemptId, flush, load]);

  // Timer tampilan. Saat nol, kirim: server yang memutuskan (jawaban setelah batas ditolak).
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) { clearInterval(t); void finish(); }
    }, 1000);
    return () => clearInterval(t);
  }, [active, finish]);

  // Sinyal browser = indikasi, bukan bukti. Hanya jeda > 3 dtk yang dilaporkan; server menentukan tingkat peringatan.
  useEffect(() => {
    if (!active) return;
    let start: number | null = null;
    let type = "WINDOW_BLUR";
    const begin = (t: string) => { if (start === null) { start = Date.now(); type = t; } else if (t === "TAB_SWITCH") type = t; };
    const end = () => {
      if (start === null) return;
      const s = start; start = null;
      void ulangan.reportLeave(attemptId, type, s, Date.now() - s).then((r) => {
        if (r?.recorded && r.warningLevel > 0) setWarning(ulangan.warningText(r.warningLevel));
      }).catch(() => {});
    };
    const onVis = () => (document.visibilityState === "hidden" ? begin("TAB_SWITCH") : document.hasFocus() && end());
    const onBlur = () => begin("WINDOW_BLUR");
    window.addEventListener("blur", onBlur); window.addEventListener("focus", end);
    document.addEventListener("visibilitychange", onVis); window.addEventListener("pointerdown", end);
    return () => {
      window.removeEventListener("blur", onBlur); window.removeEventListener("focus", end);
      document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pointerdown", end);
    };
  }, [active, attemptId]);

  function choose(qid: string, oid: string) {
    setAnswers((a) => ({ ...a, [qid]: oid }));
    pending.current.set(qid, oid);
    setUnsaved(pending.current.size);
    void flush();
  }

  if (!view) return <InlineAlert message={error || "Memuat..."} />;
  if (!active) {
    const r = view.attempt.result;
    return (
      <div className="bg-white p-6 rounded-3xl border border-gray-100 text-center space-y-3">
        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
        <p className="text-sm font-extrabold text-gray-900">{view.attempt.status === "expired" ? "Waktu habis — jawabanmu sudah dikumpulkan" : "Jawabanmu sudah dikumpulkan"}</p>
        {r ? <p className="text-xs text-gray-600">Nilai: <b>{r.score}</b> ({r.correctCount}/{r.maxScore} poin benar)</p> : <p className="text-xs text-gray-500">Nilai akan diumumkan gurumu.</p>}
        <button type="button" onClick={() => router.push("/student/ulangan")} className="px-5 py-2.5 rounded-2xl text-xs font-bold bg-gray-100">Kembali</button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-extrabold text-gray-900 truncate">{view.attempt.title}</p>
        <p className={`text-sm font-black tabular-nums ${left <= 60 && left > 0 ? "text-red-600" : "text-gray-900"}`}>{clock(left || view.attempt.remainingSeconds)}</p>
      </div>
      <InlineAlert message={error} onDismiss={() => setError("")} />
      {warning && (
        <div role="alert" className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /><span className="flex-1">{warning}</span>
          <button type="button" onClick={() => setWarning("")} className="underline">Mengerti</button>
        </div>
      )}
      {unsaved > 0 && <p className="text-[10px] font-bold text-amber-600">{unsaved} jawaban belum tersimpan — menyimpan ulang otomatis...</p>}
      {view.questions.map((q) => (
        <div key={q.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
          <p className="text-xs font-bold text-gray-900 whitespace-pre-wrap"><span className="text-blue-600">{q.position}.</span> {q.body}</p>
          <div className="space-y-2">
            {q.options.map((o) => (
              <button key={o.id} type="button" onClick={() => choose(q.id, o.id)} aria-pressed={answers[q.id] === o.id}
                className={`w-full text-left px-3.5 py-3 rounded-xl text-xs border transition-colors ${answers[q.id] === o.id ? "bg-blue-50 border-blue-500 font-bold text-blue-800" : "bg-white border-gray-200 text-gray-700"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white border-t border-gray-100">
        {confirmSubmit ? (
          <div className="max-w-2xl mx-auto flex gap-2">
            <button type="button" onClick={() => setConfirmSubmit(false)} className="flex-1 py-3 rounded-2xl text-xs font-bold bg-gray-100">Batal</button>
            <button type="button" disabled={finishing} onClick={() => void finish()} className="flex-1 py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white disabled:bg-blue-300">
              {finishing ? "Mengirim..." : `Kumpulkan (${Object.keys(answers).length}/${view.questions.length} terjawab)`}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmSubmit(true)} className="max-w-2xl mx-auto block w-full py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white">Selesai & Kumpulkan</button>
        )}
      </div>
    </div>
  );
}

export default function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  return <StudentShell title="Ulangan">{() => <Exam attemptId={attemptId} />}</StudentShell>;
}
