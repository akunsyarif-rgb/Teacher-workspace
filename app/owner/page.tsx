"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { auth } from "@/src/config/firebase";
import LoadingSpinner from "@/src/components/ui/LoadingSpinner";
import * as ownerController from "@/lib/controllers/ownerController";
import type { OwnerWorkspace } from "@/lib/controllers/ownerController";

const PLANS = [
  { value: "individual_lifetime", label: "Gratis (individual_lifetime)" },
  { value: "individual_onetime", label: "Individual sekali bayar" },
  { value: "individual_monthly", label: "Individual bulanan" },
  { value: "school_annual", label: "Sekolah tahunan (school_annual)" },
];

function toLimit(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : Number(trimmed);
}

// Panel pemilik aplikasi (alamat /owner, tanpa tautan di menu). Yang
// menegakkan izin adalah server (env APP_OWNER_UIDS); halaman ini hanya
// menampilkan pesan kalau server menolak.
function WorkspaceRow({ workspace, onSaved }: { workspace: OwnerWorkspace; onSaved: () => void }) {
  const [plan, setPlan] = useState(workspace.plan);
  const [seatLimit, setSeatLimit] = useState(workspace.seatLimit?.toString() ?? "");
  const [classLimit, setClassLimit] = useState(workspace.classLimit?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSave() {
    const user = auth.currentUser;
    if (!user) return;
    setSaving(true);
    setMessage("");
    try {
      const idToken = await user.getIdToken();
      await ownerController.saveOwnerWorkspace(idToken, workspace.id, {
        plan,
        seatLimit: toLimit(seatLimit),
        classLimit: toLimit(classLimit),
      });
      setMessage("Tersimpan.");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-nb-paper p-5 rounded-3xl shadow-sm border border-nb-rule space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-nb-ink truncate">{workspace.name || "(tanpa nama)"}</p>
          <p className="text-xs text-nb-ink-muted break-all">ID {workspace.id}</p>
        </div>
        <span className="text-xs font-bold text-nb-ink-muted shrink-0">{workspace.memberCount} guru</span>
      </div>
      <label className="block text-xs font-bold text-nb-ink-muted">
        Plan
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="mt-1 w-full p-2.5 bg-nb-paper border border-nb-control rounded-xl text-xs">
          {PLANS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
          {!PLANS.some((p) => p.value === workspace.plan) && <option value={workspace.plan}>{workspace.plan || "(kosong)"}</option>}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-bold text-nb-ink-muted">
          Kuota guru
          <input value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} inputMode="numeric" placeholder="kosong = tak terbatas" className="mt-1 w-full p-2.5 bg-nb-paper border border-nb-control rounded-xl text-xs" />
        </label>
        <label className="block text-xs font-bold text-nb-ink-muted">
          Batas kelas
          <input value={classLimit} onChange={(e) => setClassLimit(e.target.value)} inputMode="numeric" placeholder="kosong = tak terbatas" className="mt-1 w-full p-2.5 bg-nb-paper border border-nb-control rounded-xl text-xs" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="px-4 py-2.5 bg-nb-green hover:bg-nb-green-strong disabled:opacity-50 text-white rounded-xl text-xs font-bold">
          {saving ? "Menyimpan..." : "Simpan"}
        </button>
        {message && <p className="text-xs font-bold text-nb-ink-muted">{message}</p>}
      </div>
    </div>
  );
}

export default function OwnerPage() {
  const [workspaces, setWorkspaces] = useState<OwnerWorkspace[] | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const fetchRows = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("Sesi tidak valid. Silakan masuk kembali.");
    return ownerController.fetchOwnerWorkspaces(await user.getIdToken());
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Tunggu sesi Auth pulih sebelum meminta ke server.
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) {
        if (!cancelled) setError("Silakan masuk dulu.");
        return;
      }
      fetchRows()
        .then((rows) => {
          if (!cancelled) {
            setWorkspaces(rows);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Gagal memuat.");
        });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [fetchRows, reloadKey]);

  return (
    <div className="min-h-screen bg-nb-workspace p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/account" className="p-2 -ml-2 text-nb-ink-muted hover:text-nb-ink-muted" aria-label="Kembali ke Akun">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-nb-ink">Panel Pemilik Aplikasi</h1>
            <p className="text-xs text-nb-ink-muted">Atur plan, kuota guru, dan batas kelas workspace</p>
          </div>
        </div>

        {error ? (
          <div className="bg-nb-paper p-6 rounded-3xl border border-nb-rule shadow-sm text-xs font-bold text-red-600">{error}</div>
        ) : workspaces === null ? (
          <LoadingSpinner text="Memuat workspace..." />
        ) : workspaces.length === 0 ? (
          <p className="text-xs text-nb-ink-muted">Belum ada workspace.</p>
        ) : (
          workspaces.map((w) => <WorkspaceRow key={w.id} workspace={w} onSaved={() => setReloadKey((k) => k + 1)} />)
        )}
      </div>
    </div>
  );
}
