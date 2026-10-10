"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import InlineAlert from "@/src/components/ui/InlineAlert";
import PackageEditor from "@/src/components/ulangan/PackageEditor";
import ExamForm from "@/src/components/ulangan/ExamForm";
import ExamMonitor from "@/src/components/ulangan/ExamMonitor";
import * as ulangan from "@/lib/controllers/ulanganController";
import { fetchClassSummaries } from "@/lib/controllers/classController";
import { isUlanganEnabled } from "@/lib/config/ulangan";
import type { ExamSummary, PackageDetail, PackageSummary } from "@/lib/types/ulangan";

type Mode = { k: "list" } | { k: "package"; detail?: PackageDetail } | { k: "exam" } | { k: "monitor"; id: string };
const STATUS: Record<string, string> = { draft: "Draft", published: "Terbit", closed: "Ditutup", final: "Final" };
const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Makassar", dateStyle: "medium", timeStyle: "short" });

export default function UlanganPage() {
  const { workspaceId } = useWorkspace();
  const [mode, setMode] = useState<Mode>({ k: "list" });
  const [tab, setTab] = useState<"exams" | "packages">("exams");
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [classNames, setClassNames] = useState<string[]>([]);
  const [error, setError] = useState("");

  const fetchAll = useCallback(
    () => Promise.all([ulangan.fetchExams(), ulangan.fetchPackages(), workspaceId ? fetchClassSummaries(workspaceId) : Promise.resolve([])]),
    [workspaceId]
  );
  const apply = useCallback(([e, p, c]: [ExamSummary[], PackageSummary[], { className: string }[]]) => {
    setExams(e); setPackages(p); setClassNames(c.map((x) => x.className));
  }, []);
  const load = useCallback(() => fetchAll().then(apply).catch((err) => setError(ulangan.describeError(err))), [fetchAll, apply]);
  useEffect(() => {
    if (!isUlanganEnabled()) return;
    let off = false;
    // Segarkan proyeksi identitas + daftar siswa dari server dulu; bila gagal, galat jelas muncul dan data tidak dimuat.
    ulangan.refreshIdentity(true)
      .then(() => fetchAll())
      .then((r) => { if (!off) apply(r); })
      .catch((err) => { if (!off) setError(ulangan.describeError(err)); });
    return () => { off = true; };
  }, [fetchAll, apply]);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try { await fn(); await load(); } catch (err) { setError(ulangan.describeError(err)); }
  }

  if (!isUlanganEnabled()) return <div className="p-6 text-xs text-gray-500">Fitur Ulangan Harian belum diaktifkan.</div>;
  const done = () => { setMode({ k: "list" }); void load(); };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center"><ClipboardCheck className="w-5 h-5" /></div>
          <div><h1 className="text-xl font-extrabold text-gray-900">Ulangan Harian</h1><p className="text-xs text-gray-500">Paket soal, jadwal, dan pemantauan</p></div>
        </div>
        <InlineAlert message={error} onDismiss={() => setError("")} />
        {mode.k === "package" && <PackageEditor initial={mode.detail} onSaved={done} onCancel={() => setMode({ k: "list" })} />}
        {mode.k === "exam" && <ExamForm packages={packages} classNames={classNames} onSaved={done} onCancel={() => setMode({ k: "list" })} />}
        {mode.k === "monitor" && <ExamMonitor examId={mode.id} onClose={done} />}
        {mode.k === "list" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {(["exams", "packages"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`py-2.5 rounded-2xl text-xs font-bold ${tab === t ? "bg-blue-600 text-white" : "bg-white border border-gray-100"}`}>{t === "exams" ? "Ulangan" : "Paket Soal"}</button>
              ))}
            </div>
            {tab === "exams" ? (
              <>
                <button type="button" onClick={() => setMode({ k: "exam" })} className="w-full py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white">+ Ulangan Baru</button>
                {exams.map((e) => (
                  <div key={e.id} className="bg-white p-4 rounded-2xl border border-gray-100 space-y-2">
                    <p className="text-xs font-extrabold">{e.title} <span className="text-[10px] font-bold text-blue-600">{STATUS[e.status]}</span></p>
                    <p className="text-[10px] text-gray-500">{e.packageTitle} · {e.durationMinutes} mnt · {e.classNames.join(", ")} · {fmt(e.opensAt)} – {fmt(e.closesAt)}</p>
                    <div className="flex gap-2 flex-wrap">
                      {e.status === "draft" && <button type="button" className="px-3 py-2 rounded-xl text-[11px] font-bold bg-blue-600 text-white" onClick={() => act(() => ulangan.publishExam(e.id))}>Terbitkan</button>}
                      {e.status === "draft" && <button type="button" className="px-3 py-2 rounded-xl text-[11px] font-bold bg-red-50 text-red-600" onClick={() => act(() => ulangan.removeExam(e.id))}>Hapus</button>}
                      {e.status !== "draft" && <button type="button" className="px-3 py-2 rounded-xl text-[11px] font-bold bg-gray-100" onClick={() => setMode({ k: "monitor", id: e.id })}>Pantau & Hasil</button>}
                      {e.status === "published" && <button type="button" className="px-3 py-2 rounded-xl text-[11px] font-bold bg-amber-50 text-amber-700" onClick={() => { if (window.confirm("Tutup ulangan? Pengerjaan yang berjalan akan dinilai dan dikumpulkan.")) void act(() => ulangan.closeExam(e.id)); }}>Tutup</button>}
                    </div>
                  </div>
                ))}
                {exams.length === 0 && <p className="text-xs text-gray-500 text-center py-6">Belum ada ulangan.</p>}
              </>
            ) : (
              <>
                <button type="button" onClick={() => setMode({ k: "package" })} className="w-full py-3 rounded-2xl text-xs font-bold bg-blue-600 text-white">+ Paket Soal Baru</button>
                {packages.map((p) => (
                  <div key={p.id} className="bg-white p-4 rounded-2xl border border-gray-100 space-y-2">
                    <p className="text-xs font-extrabold">{p.title} <span className="text-[10px] font-bold text-blue-600">{STATUS[p.status]}</span></p>
                    <p className="text-[10px] text-gray-500">{p.subject || "—"} · {p.questionCount} soal</p>
                    <div className="flex gap-2">
                      <button type="button" className="px-3 py-2 rounded-xl text-[11px] font-bold bg-gray-100" onClick={() => act(async () => setMode({ k: "package", detail: await ulangan.fetchPackage(p.id) }))}>Edit</button>
                      <button type="button" className="px-3 py-2 rounded-xl text-[11px] font-bold bg-red-50 text-red-600" onClick={() => { if (window.confirm("Hapus paket?")) void act(() => ulangan.removePackage(p.id)); }}>Hapus</button>
                    </div>
                  </div>
                ))}
                {packages.length === 0 && <p className="text-xs text-gray-500 text-center py-6">Belum ada paket soal.</p>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
