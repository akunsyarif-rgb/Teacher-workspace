"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, UserMinus, Users } from "lucide-react";
import { auth } from "@/src/config/firebase";
import { useWorkspace } from "@/src/context/WorkspaceContext";
import WorkspaceGuard from "@/src/components/ui/WorkspaceGuard";
import InviteCodeCard from "@/src/components/workspace/InviteCodeCard";
import ConfirmDeleteModal from "@/src/components/ui/ConfirmDeleteModal";
import LoadingSpinner from "@/src/components/ui/LoadingSpinner";
import * as workspaceController from "@/lib/controllers/workspaceController";
import type { WorkspaceMember } from "@/lib/controllers/workspaceController";

const ROLE_LABEL: Record<string, string> = { OWNER: "Pemilik", ADMIN: "Admin", TEACHER: "Guru" };

// Menu Admin — hanya OWNER workspace sekolah. Pembatasan di UI ini hanya
// kenyamanan; yang menegakkan izin adalah /api/workspace/members (server).
export default function AdminPage() {
  const { role, workspace, loading: workspaceLoading } = useWorkspace();
  const allowed = role === "OWNER" && workspace?.plan === "school_annual";

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [seatLimit, setSeatLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<WorkspaceMember | null>(null);

  const fetchMembers = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("Sesi tidak valid. Silakan masuk kembali.");
    const idToken = await user.getIdToken();
    return workspaceController.fetchWorkspaceMembers(idToken);
  }, []);

  // Muat awal: state hanya diubah di callback promise dan dibatalkan saat unmount.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    fetchMembers()
      .then((result) => {
        if (cancelled) return;
        setMembers(result.members);
        setSeatLimit(result.seatLimit);
        setError("");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Gagal memuat daftar guru.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, fetchMembers]);

  async function handleRemove() {
    const user = auth.currentUser;
    if (!user || !removeTarget) return;
    const idToken = await user.getIdToken();
    await workspaceController.removeWorkspaceMember(idToken, removeTarget.uid);
    const result = await fetchMembers();
    setMembers(result.members);
    setSeatLimit(result.seatLimit);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/account" className="p-2 -ml-2 text-gray-400 hover:text-gray-600" aria-label="Kembali ke Akun">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Menu Admin</h1>
            <p className="text-xs text-gray-500">Kelola guru di workspace sekolahmu</p>
          </div>
        </div>

        <WorkspaceGuard>
          {workspaceLoading ? (
            <LoadingSpinner text="Memuat..." />
          ) : !allowed ? (
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm text-center space-y-1">
              <p className="text-sm font-extrabold text-gray-900">Menu ini khusus pemilik workspace sekolah</p>
              <p className="text-xs text-gray-500">Akunmu tidak memiliki akses ke halaman ini.</p>
            </div>
          ) : (
            <>
              <InviteCodeCard />

              <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    <p className="text-sm font-extrabold text-gray-900">Guru di Workspace</p>
                  </div>
                  <p className="text-[11px] font-bold text-gray-400">
                    {members.length}
                    {seatLimit !== null ? ` dari ${seatLimit}` : ""} guru
                  </p>
                </div>

                {loading ? (
                  <LoadingSpinner text="Memuat daftar guru..." />
                ) : error ? (
                  <p className="text-xs font-bold text-red-600">{error}</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {members.map((member) => (
                      <li key={member.uid} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-900 truncate">
                            {member.name}
                            {member.isYou && <span className="text-gray-400 font-medium"> (kamu)</span>}
                          </p>
                          <p className="text-[11px] text-gray-500 truncate">
                            {[member.email, member.subject].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-extrabold uppercase tracking-wide text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
                            {ROLE_LABEL[member.role] || member.role}
                          </span>
                          {member.role !== "OWNER" && !member.isYou && (
                            <button
                              onClick={() => setRemoveTarget(member)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                              aria-label={`Keluarkan ${member.name}`}
                              title="Keluarkan dari workspace"
                            >
                              <UserMinus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </WorkspaceGuard>
      </div>

      <ConfirmDeleteModal
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title="Keluarkan guru?"
        itemName={removeTarget?.name || ""}
        itemDetail="Guru ini dilepas dari workspace dan tidak bisa membuka datanya lagi. Akunnya tidak dihapus, dan data yang sudah ia buat tetap ada di workspace. Selama kode undangan lama masih aktif ia bisa bergabung lagi — buat kode baru setelah mengeluarkannya."
        requireTyping={false}
      />
    </div>
  );
}
