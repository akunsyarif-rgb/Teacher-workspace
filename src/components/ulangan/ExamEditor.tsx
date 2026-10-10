"use client";

import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as ulangan from "@/lib/controllers/ulanganController";
import type { ExamDetail, QuestionInput } from "@/lib/types/ulangan";

const field = "w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs";
const blankQ = (): QuestionInput => ({ body: "", options: ["", "", "", ""], correctIndex: 0 });
const toLocal = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : "");

// Satu form: judul, soal pilihan ganda, kelas, jadwal. Simpan sebagai draft atau langsung terbitkan.
export default function ExamEditor({ initial, classNames, onSaved, onCancel }: {
  initial?: ExamDetail; classNames: string[]; onSaved: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [qs, setQs] = useState<QuestionInput[]>(initial ? initial.questions.map((q) => ({ body: q.body, points: q.points, options: q.options.map((o) => o.label), correctIndex: q.correctIndex })) : [blankQ()]);
  const [duration, setDuration] = useState(initial?.durationMinutes ?? 30);
  const [opens, setOpens] = useState(initial ? toLocal(initial.opensAt) : "");
  const [closes, setCloses] = useState(initial ? toLocal(initial.closesAt) : "");
  const [classes, setClasses] = useState<string[]>(initial?.classNames ?? []);
  const [shuffle, setShuffle] = useState(initial?.shuffle ?? true);
  const [showResult, setShowResult] = useState(initial?.showResult ?? false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (i: number, f: Partial<QuestionInput>) => setQs((a) => a.map((q, j) => (j === i ? { ...q, ...f } : q)));

  async function save(publish: boolean) {
    setBusy(true); setError("");
    try {
      const id = await ulangan.submitExam({
        id: initial?.id, title, subject, durationMinutes: duration, opensAt: toIso(opens), closesAt: toIso(closes),
        classNames: classes, shuffle, showResult, questions: qs,
      });
      if (publish) await ulangan.publishExam(id);
      onSaved();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setError(/^[A-Z]/.test(m) ? m : ulangan.describeError(e)); // pesan validasi UX berawalan huruf besar; kode server dipetakan
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <InlineAlert message={error} onDismiss={() => setError("")} />
      <input className={field} placeholder="Judul ulangan (mis. UH Bab 1)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      <input className={field} placeholder="Mata pelajaran" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={100} />
      {qs.map((q, i) => (
        <div key={i} className="bg-white p-3 rounded-2xl border border-gray-100 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-extrabold">Soal {i + 1}</p>
            <button type="button" aria-label={`Hapus soal ${i + 1}`} onClick={() => setQs((a) => a.filter((_, j) => j !== i))} className="p-2 text-red-500"><Trash2 className="w-4 h-4" /></button>
          </div>
          <textarea className={field} rows={2} placeholder="Teks soal" value={q.body} onChange={(e) => patch(i, { body: e.target.value })} maxLength={2000} />
          {q.options.map((o, k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name={`key-${i}`} checked={q.correctIndex === k} onChange={() => patch(i, { correctIndex: k })} aria-label={`Kunci soal ${i + 1} pilihan ${k + 1}`} />
              <input className={field} placeholder={`Pilihan ${String.fromCharCode(65 + k)}`} value={o} onChange={(e) => patch(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} maxLength={500} />
            </label>
          ))}
          <p className="text-[10px] text-gray-400">Pilih tombol bulat di samping jawaban yang benar.</p>
        </div>
      ))}
      <button type="button" onClick={() => setQs((a) => [...a, blankQ()])} disabled={qs.length >= 100} className="w-full py-2.5 rounded-2xl text-xs font-bold bg-gray-100 flex items-center justify-center gap-1"><Plus className="w-4 h-4" />Tambah soal</button>

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
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />Acak urutan soal dan pilihan</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showResult} onChange={(e) => setShowResult(e.target.checked)} />Tampilkan nilai ke siswa setelah selesai</label>
      <p className="text-[10px] text-gray-400">Ulangan yang sudah diterbitkan tidak bisa diubah. Waktu mengikuti jam perangkatmu; server membatasi waktu pengerjaan siswa.</p>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onCancel} className="py-3 rounded-2xl text-xs font-bold bg-gray-100">Batal</button>
        <button type="button" disabled={busy} onClick={() => save(false)} className="py-3 rounded-2xl text-xs font-bold bg-gray-200">Simpan Draft</button>
        <button type="button" disabled={busy} onClick={() => save(true)} className="py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white disabled:bg-blue-300">Terbitkan</button>
      </div>
    </div>
  );
}
