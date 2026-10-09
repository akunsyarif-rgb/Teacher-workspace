"use client";

import React, { useState } from "react";
import { KeyRound, Copy, Check, RefreshCw } from "lucide-react";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import * as workspaceController from "@/lib/controllers/workspaceController";

// Kartu kode undangan sekolah — dipakai di halaman Akun dan Menu Admin.
// Hanya dirender oleh pemanggil yang sudah memeriksa role/plan; izin tulis
// sebenarnya tetap dijaga firestore.rules (workspace_invites).
export default function InviteCodeCard() {
  const { workspace, refreshProfile } = useWorkspace();
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  // Snapshot waktu saat komponen dibuat (Date.now() tidak boleh dipanggil saat render).
  const [now] = useState(() => Date.now());

  const isExpired = !!workspace?.inviteCodeExpiresAt && workspace.inviteCodeExpiresAt < now;
  const expiresLabel = workspace?.inviteCodeExpiresAt
    ? new Date(workspace.inviteCodeExpiresAt).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  async function handleCopy() {
    if (!workspace?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(workspace.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API diblokir (mis. halaman non-HTTPS di HP) — kodenya
      // tetap terlihat di layar.
      alert(`Kode undangan: ${workspace.inviteCode}`);
    }
  }

  async function handleRegenerate() {
    if (!workspace?.id) return;
    setRegenerating(true);
    try {
      await workspaceController.submitRegenerateInviteCode(workspace.id);
      await refreshProfile();
    } catch (error) {
      alert(error instanceof Error && error.message ? error.message : "Gagal membuat kode undangan baru.");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-blue-600" />
        <p className="text-sm font-extrabold text-gray-900">Kode Undangan Sekolah</p>
      </div>
      <p className="text-[11px] text-gray-500">
        Bagikan kode ini ke guru lain agar mereka bisa bergabung ke workspace ini lewat menu &quot;Gabung&quot;
        saat mendaftar.
      </p>

      {workspace?.inviteCode ? (
        <>
          <div className="flex items-center justify-between gap-2 p-3 bg-gray-50 rounded-2xl border border-gray-200">
            <span className="text-lg font-extrabold tracking-widest text-blue-600">{workspace.inviteCode}</span>
            <button
              onClick={handleCopy}
              className="p-2.5 bg-white border border-gray-200 hover:border-blue-300 rounded-xl transition-colors"
              title="Salin kode undangan"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-gray-400" />}
            </button>
          </div>
          <p className={`text-[10px] font-bold ${isExpired ? "text-red-500" : "text-gray-400"}`}>
            {isExpired ? "Kode ini sudah kedaluwarsa." : `Berlaku sampai ${expiresLabel}.`}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-gray-400">Belum ada kode undangan aktif.</p>
      )}

      <button
        onClick={handleRegenerate}
        disabled={regenerating}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-600 rounded-xl text-xs font-bold transition-colors"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
        {regenerating ? "Membuat kode baru..." : "Buat Kode Baru"}
      </button>
    </div>
  );
}
