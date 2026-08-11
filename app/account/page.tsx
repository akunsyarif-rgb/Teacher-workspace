"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";
import * as workspaceController from "@/lib/controllers/workspaceController";
import { User, ChevronRight, LogOut, BarChart3, Wallet, KeyRound, Copy, Check, RefreshCw, Database } from "lucide-react";

export default function AccountPage() {
  const router = useRouter();
  const { user, teacherProfile, workspace, role, refreshProfile } = useWorkspace();
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isInviteCodeExpired, setIsInviteCodeExpired] = useState(false);

  async function handleLogout() {
    try {
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Gagal keluar:", error);
    }
  }

  // Kode undangan hanya berarti untuk workspace sekolah (school_annual) —
  // individual tidak pernah punya lebih dari satu guru. Hanya OWNER/ADMIN
  // yang boleh melihat/membuat ulang, sama seperti pembatasan di
  // firestore.rules (workspace_invites allow create/update hanya utk owner).
  const canManageInviteCode = (role === "OWNER" || role === "ADMIN") && workspace?.plan === "school_annual";

  useEffect(() => {
    setIsInviteCodeExpired(!!workspace?.inviteCodeExpiresAt && workspace.inviteCodeExpiresAt < Date.now());
  }, [workspace?.inviteCodeExpiresAt]);

  const inviteCodeExpiresLabel = workspace?.inviteCodeExpiresAt
    ? new Date(workspace.inviteCodeExpiresAt).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  async function handleCopyInviteCode() {
    if (!workspace?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(workspace.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API diblokir (mis. halaman non-HTTPS di HP) — kodenya
      // tetap terlihat di layar, sama seperti fallback di ClassDetail.tsx.
      alert(`Kode undangan: ${workspace.inviteCode}`);
    }
  }

  async function handleRegenerateInviteCode() {
    if (!workspace?.id) return;
    setRegenerating(true);
    try {
      await workspaceController.submitRegenerateInviteCode(workspace.id);
      await refreshProfile();
    } catch (error: any) {
      alert(error.message || "Gagal membuat kode undangan baru.");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Akun</h1>
            <p className="text-xs text-gray-500">Profil, statistik, dan sesi masuk</p>
          </div>
        </div>

        <WorkspaceGuard>
          <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 space-y-1">
            <p className="text-sm font-extrabold text-gray-900">{teacherProfile?.name || "Guru Pengajar"}</p>
            <p className="text-xs text-gray-500">{user?.email}</p>
            {teacherProfile?.subject && (
              <p className="text-xs text-gray-500">
                Mapel Utama: <span className="font-bold text-blue-600">{teacherProfile.subject}</span>
              </p>
            )}
          </div>

          {canManageInviteCode && (
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
                    <span className="text-lg font-extrabold tracking-widest text-blue-600">
                      {workspace.inviteCode}
                    </span>
                    <button
                      onClick={handleCopyInviteCode}
                      className="p-2.5 bg-white border border-gray-200 hover:border-blue-300 rounded-xl transition-colors"
                      title="Salin kode undangan"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                  </div>
                  <p className={`text-[10px] font-bold ${isInviteCodeExpired ? "text-red-500" : "text-gray-400"}`}>
                    {isInviteCodeExpired ? "Kode ini sudah kedaluwarsa." : `Berlaku sampai ${inviteCodeExpiresLabel}.`}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-gray-400">Belum ada kode undangan aktif.</p>
              )}

              <button
                onClick={handleRegenerateInviteCode}
                disabled={regenerating}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-600 rounded-xl text-xs font-bold transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
                {regenerating ? "Membuat kode baru..." : "Buat Kode Baru"}
              </button>
            </div>
          )}

          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden">
            <Link
              href="/profile"
              className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50 transition-colors"
            >
              <span className="text-xs font-bold text-gray-700">Ubah Profil & Pengaturan</span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              href="/analytics"
              className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <BarChart3 className="w-4 h-4 text-gray-400" />
                Statistik & Laporan
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              href="/account/data-arsip"
              className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <Database className="w-4 h-4 text-gray-400" />
                Data & Arsip
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              href="/upgrade"
              className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <Wallet className="w-4 h-4 text-gray-400" />
                Paket Berlangganan
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 p-4 bg-white hover:bg-red-50 text-red-600 rounded-3xl shadow-sm border border-gray-100 hover:border-red-200 text-xs font-bold transition-colors active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4" />
            Keluar
          </button>
        </WorkspaceGuard>
      </div>
    </div>
  );
}
