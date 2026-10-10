"use client";

import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import InlineAlert from "@/src/components/ui/InlineAlert";
import * as ulangan from "@/lib/controllers/ulanganController";
import type { PackageDetail, PackageInput } from "@/lib/types/ulangan";

type Q = { body: string; options: string[]; correctIndex: number };
const blankQ = (): Q => ({ body: "", options: ["", "", "", ""], correctIndex: 0 });

export default function PackageEditor({ initial, onSaved, onCancel }: { initial?: PackageDetail; onSaved: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [qs, setQs] = useState<Q[]>(initial ? initial.questions.map((q) => ({ body: q.body, options: q.options.map((o) => o.label), correctIndex: q.correctIndex })) : [blankQ()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (i: number, f: Partial<Q>) => setQs((a) => a.map((q, j) => (j === i ? { ...q, ...f } : q)));

  async function save(status: PackageInput["status"]) {
    setBusy(true); setError("");
    try {
      await ulangan.submitPackage({ id: initial?.id, title, subject, status, questions: qs });
      onSaved();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setError(/^[A-Z]/.test(m) && !/Supabase/.test(m) ? m : ulangan.describeError(e));
    } finally { setBusy(false); }
  }

  const field = "w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs";
  return (
    <div className="space-y-4">
      <InlineAlert message={error} onDismiss={() => setError("")} />
      <input className={field} placeholder="Judul paket (mis. UH Bab 1)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
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
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onCancel} className="py-3 rounded-2xl text-xs font-bold bg-gray-100">Batal</button>
        <button type="button" disabled={busy} onClick={() => save("draft")} className="py-3 rounded-2xl text-xs font-bold bg-gray-200">Simpan Draft</button>
        <button type="button" disabled={busy} onClick={() => save("final")} className="py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white disabled:bg-blue-300">Simpan Final</button>
      </div>
    </div>
  );
}
