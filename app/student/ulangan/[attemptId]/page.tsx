"use client";

import React, { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as ulangan from "@/lib/controllers/ulanganController";
import type { AttemptView } from "@/lib/types/ulangan";

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const AUTO_SUBMIT_RETRY_MS = 5000;

function Exam({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const [view, setView] = useState<AttemptView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [unsaved, setUnsaved] = useState(0);
  const [pendingIds, setPendingIds] = useState<string[]>([]); // soal yang jawabannya belum dikonfirmasi server
  const [saveFailed, setSaveFailed] = useState(false); // percobaan simpan terakhir gagal (jaringan); dicoba lagi otomatis
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // null = belum ada data server. Tidak pernah "jatuh" kembali ke durasi awal: 0 tetap 0 (00:00).
  const [left, setLeft] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitBlocked, setSubmitBlocked] = useState(false); // kumpul ditahan karena ada jawaban yang belum dikonfirmasi server
  const [lostOnExpiry, setLostOnExpiry] = useState(0); // jawaban yang tidak sempat tersimpan sebelum server menutup pengerjaan
  const deadline = useRef(0); // ms epoch lokal = waktu terima + sisa detik dari SERVER (jam perangkat tidak dipercaya untuk keputusan)
  const finishingRef = useRef(false); // satu proses kumpul pada satu waktu (klik berulang + kumpul otomatis)
  const lastAutoTry = useRef(0);
  const active = view?.attempt.status === "active";

  // Antrean autosave: hanya jawaban yang dikonfirmasi server yang keluar dari antrean (lihat lib/services/ulanganAnswerQueue.ts).
  const [queue] = useState<ulangan.AnswerQueue>(() => {
    const q: ulangan.AnswerQueue = ulangan.createAnswerQueue(
      async (qid, oid) => { await ulangan.answerQuestion(attemptId, qid, oid); setLastSavedAt(Date.now()); },
      () => { setUnsaved(q.size()); setPendingIds(q.ids()); setSaveFailed(q.failed()); }
    );
    return q;
  });

  const apply = useCallback((v: AttemptView) => {
    deadline.current = Date.now() + v.attempt.remainingSeconds * 1000;
    setLeft(v.attempt.remainingSeconds);
    setView(v);
    setAnswers({ ...v.answers, ...Object.fromEntries(queue.entries()) });
  }, [queue]);
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

  // Kirim antrean. Bila server sudah menutup pengerjaan, sisa antrean tidak akan pernah tersimpan: catat jumlahnya lalu muat status akhir.
  const flush = useCallback(async () => {
    const r = await queue.flush();
    if (!r.ok && r.closed) {
      setLostOnExpiry((n) => n + queue.size());
      queue.clear();
      await load();
    }
    return r;
  }, [queue, load]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void flush(), 5000);
    const online = () => void flush(); // jaringan pulih → coba lagi segera, tanpa menunggu interval
    window.addEventListener("online", online);
    return () => { clearInterval(t); window.removeEventListener("online", online); };
  }, [active, flush]);

  // Kumpulkan HANYA setelah semua jawaban dikonfirmasi server. Manual: bila masih ada yang belum tersimpan, tahan dan beri tahu.
  // Otomatis (waktu habis): coba simpan lalu kumpul; bila jaringan masih gagal, dicoba lagi oleh timer (server tetap menegakkan batas waktu).
  const finish = useCallback(async (auto: boolean) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true); setError(""); setSubmitBlocked(false);
    try {
      let r = await flush();
      for (let i = 0; i < 2 && !r.ok && !r.closed; i++) { await sleep(1500); r = await flush(); }
      if (!r.ok) {
        if (!r.closed && !auto) setSubmitBlocked(true);
        return; // closed: flush() sudah memuat status akhir dari server
      }
      await ulangan.finishAttempt(attemptId); // idempoten di server
      setConfirmSubmit(false);
      await load();
    } catch (e) {
      setError(ulangan.describeError(e));
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  }, [attemptId, flush, load]);

  // Timer tampilan dari sisa waktu SERVER. Saat nol: kumpul otomatis, diulang tiap 5 dtk bila gagal (mis. jaringan).
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && Date.now() - lastAutoTry.current >= AUTO_SUBMIT_RETRY_MS) {
        lastAutoTry.current = Date.now();
        void finish(true);
      }
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

  const timeUp = left === 0;
  function choose(qid: string, oid: string) {
    if (timeUp || finishingRef.current) return; // tidak menerima perubahan saat waktu habis atau sedang mengumpulkan
    setAnswers((a) => ({ ...a, [qid]: oid }));
    setSubmitBlocked(false);
    queue.set(qid, oid);
    void flush();
  }

  if (!view) return <InlineAlert message={error || "Memuat..."} />;
  const answeredCount = view.questions.filter((q) => answers[q.id]).length;
  const pendingNumbers = view.questions.filter((q) => pendingIds.includes(q.id)).map((q) => q.position).join(", ");
  if (!active) {
    const r = view.attempt.result;
    return (
      <div className="text-gray-900 bg-white p-6 rounded-3xl border border-gray-100 text-center space-y-3">
        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
        <p className="text-sm font-extrabold text-gray-900">{view.attempt.status === "expired" ? "Waktu habis — jawaban yang tersimpan sudah dikumpulkan" : "Jawabanmu sudah dikumpulkan"}</p>
        {lostOnExpiry > 0 && (
          <p role="alert" className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
            {lostOnExpiry} jawaban terakhir tidak sempat tersimpan sebelum pengerjaan ditutup server, sehingga tidak ikut dinilai.
          </p>
        )}
        {r ? <p className="text-xs text-gray-600">Nilai: <b>{r.score}</b> ({r.correctCount}/{r.maxScore} poin benar)</p> : <p className="text-xs text-gray-500">Nilai akan diumumkan gurumu.</p>}
        <button type="button" onClick={() => router.push("/student/ulangan")} className="px-5 py-2.5 rounded-2xl text-xs font-bold bg-gray-100">Kembali</button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 text-gray-900">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-extrabold text-gray-900 truncate">{view.attempt.title}</p>
        <p data-testid="ulangan-timer" className={`text-sm font-black tabular-nums ${left !== null && left <= 60 ? "text-red-600" : "text-gray-900"}`}>{clock(left ?? view.attempt.remainingSeconds)}</p>
      </div>
      <InlineAlert message={error} onDismiss={() => setError("")} />
      {timeUp && (
        <div role="alert" className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs font-bold text-red-700">
          {unsaved > 0 && saveFailed
            ? `Waktu habis. ${unsaved} jawaban belum tersimpan — mencoba menyimpan dan mengumpulkan; tetap di halaman ini.`
            : "Waktu habis — mengumpulkan jawabanmu..."}
        </div>
      )}
      {warning && (
        <div role="alert" className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /><span className="flex-1">{warning}</span>
          <button type="button" onClick={() => setWarning("")} className="underline">Mengerti</button>
        </div>
      )}
      {/* Status simpan PERMANEN (tidak hilang): menyimpan / gagal / semua tersimpan + jam terakhir. */}
      <div role="status" aria-live="polite" className={`px-3 py-2 rounded-xl text-[11px] font-bold border ${
        unsaved > 0 ? (saveFailed ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-700")
        : answeredCount > 0 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-gray-50 border-gray-200 text-gray-500"}`}>
        {unsaved > 0
          ? (saveFailed ? `${unsaved} jawaban BELUM tersimpan — koneksi bermasalah. Dicoba lagi otomatis; tetap di halaman ini.` : "Menyimpan jawaban...")
          : answeredCount > 0
            ? `✓ Semua jawaban tersimpan di server (${answeredCount}/${view.questions.length} soal terjawab)${lastSavedAt ? ` · ${new Date(lastSavedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}`
            : "Belum ada jawaban. Jawabanmu tersimpan otomatis begitu dipilih."}
      </div>
      {view.questions.map((q) => (
        <div key={q.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
          <p className="text-xs font-bold text-gray-900 whitespace-pre-wrap"><span className="text-blue-600">{q.position}.</span> {q.body}</p>
          <div className="space-y-2">
            {q.options.map((o) => (
              <button key={o.id} type="button" onClick={() => choose(q.id, o.id)} aria-pressed={answers[q.id] === o.id} disabled={timeUp || finishing}
                className={`w-full text-left px-3.5 py-3 rounded-xl text-xs border transition-colors ${answers[q.id] === o.id ? "bg-blue-50 border-blue-500 font-bold text-blue-800" : "bg-white border-gray-200 text-gray-700"}`}>
                {o.label}
              </button>
            ))}
          </div>
          {answers[q.id] && (
            <p className={`text-[10px] font-bold ${!pendingIds.includes(q.id) ? "text-emerald-600" : saveFailed ? "text-red-600" : "text-amber-600"}`}>
              {!pendingIds.includes(q.id) ? "✓ Tersimpan" : saveFailed ? "Belum tersimpan — dicoba lagi" : "Menyimpan..."}
            </p>
          )}
        </div>
      ))}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white border-t border-gray-100">
        {submitBlocked && unsaved > 0 && (
          <p role="alert" className="max-w-2xl mx-auto mb-2 text-[11px] font-bold text-red-700">
            Belum dikumpulkan: {unsaved} jawaban belum tersimpan di server (soal {pendingNumbers}). Periksa koneksi, lalu tekan Kumpulkan lagi.
          </p>
        )}
        {confirmSubmit && !submitBlocked && unsaved > 0 && (
          <p className="max-w-2xl mx-auto mb-2 text-[11px] font-bold text-amber-700">{unsaved} jawaban sedang disimpan; dikumpulkan setelah tersimpan.</p>
        )}
        {timeUp ? null : confirmSubmit ? (
          <div className="max-w-2xl mx-auto flex gap-2">
            <button type="button" disabled={finishing} onClick={() => { setConfirmSubmit(false); setSubmitBlocked(false); }} className="flex-1 py-3 rounded-2xl text-xs font-bold bg-gray-100 disabled:opacity-50">Batal</button>
            <button type="button" disabled={finishing} onClick={() => void finish(false)} className="flex-1 py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white disabled:bg-blue-300">
              {finishing ? (unsaved > 0 ? "Menyimpan jawaban..." : "Mengirim...") : `Kumpulkan (${answeredCount}/${view.questions.length} terjawab)`}
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
