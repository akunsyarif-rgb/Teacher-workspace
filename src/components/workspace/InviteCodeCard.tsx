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
    <div className="bg-nb-paper p-5 rounded-3xl shadow-sm border border-nb-rule space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-nb-green" />
        <p className="text-sm font-extrabold text-nb-ink">Kode Undangan Sekolah</p>
      </div>
      <p className="text-xs text-nb-ink-muted">
        Bagikan kode ini ke guru lain agar mereka bisa bergabung ke workspace ini lewat menu &quot;Gabung&quot;
        saat mendaftar.
      </p>

      {workspace?.inviteCode ? (
        <>
          <div className="flex items-center justify-between gap-2 p-3 bg-nb-workspace rounded-2xl border border-nb-rule">
            <span className="text-lg font-extrabold tracking-widest text-nb-green">{workspace.inviteCode}</span>
            <button
              onClick={handleCopy}
              className="p-2.5 bg-nb-paper border border-nb-rule hover:border-nb-green/40 rounded-xl transition-colors"
              title="Salin kode undangan"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-nb-ink-muted" />}
            </button>
          </div>
          <p className={`text-xs font-bold ${isExpired ? "text-red-500" : "text-nb-ink-muted"}`}>
            {isExpired ? "Kode ini sudah kedaluwarsa." : `Berlaku sampai ${expiresLabel}.`}
          </p>
        </>
      ) : (
        <p className="text-xs text-nb-ink-muted">Belum ada kode undangan aktif.</p>
      )}

      <button
        onClick={handleRegenerate}
        disabled={regenerating}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-nb-green-soft hover:bg-nb-green-soft disabled:opacity-50 text-nb-green rounded-xl text-xs font-bold transition-colors"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
        {regenerating ? "Membuat kode baru..." : "Buat Kode Baru"}
      </button>
    </div>
  );
}
