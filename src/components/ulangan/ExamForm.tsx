"use client";

import React, { useState } from "react";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as ulangan from "@/lib/controllers/ulanganController";
import type { PackageSummary } from "@/lib/types/ulangan";

const toIso = (local: string) => (local ? new Date(local).toISOString() : "");
const field = "w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs";

export default function ExamForm({ packages, classNames, onSaved, onCancel }: {
  packages: PackageSummary[]; classNames: string[]; onSaved: () => void; onCancel: () => void;
}) {
  const finals = packages.filter((p) => p.status === "final" && p.questionCount > 0);
  const [packageId, setPackageId] = useState(finals[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [opens, setOpens] = useState("");
  const [closes, setCloses] = useState("");
  const [classes, setClasses] = useState<string[]>([]);
  const [shuffleQ, setShuffleQ] = useState(true);
  const [shuffleO, setShuffleO] = useState(true);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(publish: boolean) {
    setBusy(true); setError("");
    try {
      const id = await ulangan.submitExam({
        packageId, title, durationMinutes: duration, opensAt: toIso(opens), closesAt: toIso(closes), classNames: classes,
        shuffleQuestions: shuffleQ, shuffleOptions: shuffleO, showResult,
      });
      if (publish) await ulangan.publishExam(id);
      onSaved();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setError(/^[A-Z]/.test(m) && !/Supabase/.test(m) ? m : ulangan.describeError(e));
    } finally { setBusy(false); }
  }

  if (finals.length === 0) return <p className="text-xs text-gray-500">Buat dan finalkan paket soal dulu.</p>;
  return (
    <div className="space-y-3">
      <InlineAlert message={error} onDismiss={() => setError("")} />
      <select className={field} value={packageId} onChange={(e) => setPackageId(e.target.value)} aria-label="Paket soal">
        {finals.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.questionCount} soal)</option>)}
      </select>
      <input className={field} placeholder="Judul ulangan" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      <label className="block text-[10px] font-bold text-gray-500">Durasi (menit)
        <input className={field} type="number" min={1} max={300} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
      </label>
      <label className="block text-[10px] font-bold text-gray-500">Dibuka
        <input className={field} type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} />
      </label>
      <label className="block text-[10px] font-bold text-gray-500">Ditutup
        <input className={field} type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} />
      </label>
      <fieldset className="space-y-1"><legend className="text-[10px] font-bold text-gray-500">Kelas</legend>
        <div className="flex flex-wrap gap-2">
          {classNames.map((c) => (
            <label key={c} className={`px-3 py-2 rounded-xl text-xs border ${classes.includes(c) ? "bg-blue-50 border-blue-500 font-bold" : "border-gray-200"}`}>
              <input type="checkbox" className="sr-only" checked={classes.includes(c)} onChange={() => setClasses((a) => (a.includes(c) ? a.filter((x) => x !== c) : [...a, c]))} />{c}
            </label>
          ))}
        </div>
      </fieldset>
      {([["Acak urutan soal", shuffleQ, setShuffleQ], ["Acak urutan pilihan", shuffleO, setShuffleO], ["Tampilkan nilai ke siswa setelah selesai", showResult, setShowResult]] as const).map(([l, v, set]) => (
        <label key={l} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} />{l}</label>
      ))}
      <p className="text-[10px] text-gray-400">Ulangan yang sudah diterbitkan tidak bisa diubah. Waktu mengikuti jam perangkatmu; server membatasi waktu pengerjaan siswa.</p>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onCancel} className="py-3 rounded-2xl text-xs font-bold bg-gray-100">Batal</button>
        <button type="button" disabled={busy} onClick={() => save(false)} className="py-3 rounded-2xl text-xs font-bold bg-gray-200">Simpan Draft</button>
        <button type="button" disabled={busy} onClick={() => save(true)} className="py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white disabled:bg-blue-300">Terbitkan</button>
      </div>
    </div>
  );
}
