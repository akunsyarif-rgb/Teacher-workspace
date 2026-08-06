"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Clock, Send, Paperclip, FileText, X } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";
import { SkeletonCard } from "@/src/components/ui/Skeleton";
import * as studentPortalController from "@/lib/controllers/studentPortalController";
import * as submissionController from "@/lib/controllers/submissionController";
import { uploadSubmissionFile, validateUploadFile } from "@/lib/adapters/storageAdapter";
import { SUBMISSION_STATUS } from "@/lib/config/constants";
import type { StudentProfile } from "@/src/context/StudentAuthContext";

const STATUS_LABEL: Record<string, { label: string; className: string; icon: any }> = {
  [SUBMISSION_STATUS.BELUM_MENGUMPULKAN]: { label: "Belum dikumpulkan", className: "text-gray-400", icon: Circle },
  [SUBMISSION_STATUS.MENUNGGU_PENILAIAN]: { label: "Menunggu penilaian", className: "text-amber-600", icon: Clock },
  [SUBMISSION_STATUS.DINILAI]: { label: "Sudah dinilai", className: "text-emerald-600", icon: CheckCircle2 },
};

function AssignmentsContent({ profile }: { profile: StudentProfile }) {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const scope = {
    workspaceId: profile.workspaceId,
    className: profile.className,
    studentId: profile.studentId,
  };

  const loadAssignments = useCallback(async () => {
    try {
      const result = await studentPortalController.fetchAssignments({
        workspaceId: profile.workspaceId,
        className: profile.className,
        studentId: profile.studentId,
      });
      setAssignments(result);
    } catch (error) {
      console.error("Gagal memuat tugas:", error);
    } finally {
      setLoading(false);
    }
  }, [profile.workspaceId, profile.className, profile.studentId]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  function openForm(assignment: any) {
    setOpenId(assignment.id);
    setAnswer(assignment.textAnswer || "");
    setFile(null);
  }

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    try {
      // Dicek di sini juga supaya siswa tahu file-nya ditolak sebelum
      // menunggu unggahan besar selesai lalu gagal di Storage rules.
      validateUploadFile(picked);
      setFile(picked);
    } catch (error: any) {
      alert(error.message);
      e.target.value = "";
    }
  }

  async function handleSubmit(assignment: any) {
    // Salah satu boleh kosong, tapi tidak keduanya — sebagian tugas cukup
    // dijawab teks, sebagian lain berupa foto pekerjaan.
    if (!answer.trim() && !file && !assignment.fileUrl) {
      alert("Isi jawaban atau lampirkan file dulu.");
      return;
    }
    setSaving(true);
    try {
      let attachment: { fileUrl?: string; fileName?: string; filePath?: string } = {};
      if (file) {
        setUploading(true);
        attachment = await uploadSubmissionFile(scope.workspaceId, assignment.id, file);
      } else if (assignment.fileUrl) {
        // Tidak memilih file baru = pertahankan lampiran sebelumnya,
        // jangan sampai terhapus hanya karena teksnya yang diperbaiki.
        attachment = { fileUrl: assignment.fileUrl, fileName: assignment.fileName };
      }

      await submissionController.submitAssignment(
        scope.workspaceId,
        assignment.id,
        scope.studentId,
        scope.className,
        { textAnswer: answer, ...attachment }
      );
      setOpenId(null);
      setAnswer("");
      setFile(null);
      await loadAssignments();
    } catch (error: any) {
      alert(error.message || "Gagal mengumpulkan tugas.");
    } finally {
      setUploading(false);
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <p className="text-xs text-gray-400 text-center py-4">Belum ada tugas dari gurumu.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assignments.map((assignment) => {
        const status = STATUS_LABEL[assignment.status] || STATUS_LABEL[SUBMISSION_STATUS.BELUM_MENGUMPULKAN];
        const StatusIcon = status.icon;
        const isGraded = assignment.status === SUBMISSION_STATUS.DINILAI;
        const isOpen = openId === assignment.id;

        return (
          <div key={assignment.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
            <div>
              <p className="text-xs font-bold text-gray-900">{assignment.title}</p>
              {assignment.description && (
                <p className="text-[11px] text-gray-500 mt-0.5">{assignment.description}</p>
              )}
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">
                Tenggat {assignment.dueDate}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
              <span className={`flex items-center gap-1.5 text-[11px] font-bold ${status.className}`}>
                <StatusIcon className="w-3.5 h-3.5" />
                {status.label}
              </span>
              {!isGraded && !isOpen && (
                <button
                  onClick={() => openForm(assignment)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-bold transition-colors shadow-sm"
                >
                  {assignment.status === SUBMISSION_STATUS.BELUM_MENGUMPULKAN ? "Kumpulkan" : "Ubah Jawaban"}
                </button>
              )}
            </div>

            {assignment.feedback && (
              <div className="p-3 bg-emerald-50 rounded-xl">
                <p className="text-[10px] font-extrabold text-emerald-700 uppercase tracking-wider">Catatan Guru</p>
                <p className="text-[11px] text-emerald-800 mt-0.5">{assignment.feedback}</p>
              </div>
            )}

            {isOpen && (
              <div className="space-y-2 pt-1">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={4}
                  placeholder="Tulis jawabanmu di sini"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
                {file ? (
                  <div className="flex items-center justify-between gap-2 p-2.5 bg-blue-50 rounded-xl">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="text-[11px] font-bold text-blue-800 truncate">{file.name}</span>
                    </span>
                    <button
                      onClick={() => setFile(null)}
                      className="p-1 text-blue-400 hover:text-red-500 transition-colors shrink-0"
                      title="Hapus pilihan file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-1.5 p-2.5 border border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 transition-colors">
                    <Paperclip className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-[11px] font-bold text-gray-500">
                      {assignment.fileUrl ? "Ganti lampiran" : "Lampirkan foto / PDF (opsional)"}
                    </span>
                    <input
                      type="file"
                      accept="image/*,application/pdf,.doc,.docx"
                      onChange={handlePickFile}
                      className="hidden"
                    />
                  </label>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setOpenId(null)}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    onClick={() => handleSubmit(assignment)}
                    disabled={saving}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white shadow-sm transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {uploading ? "Mengunggah..." : saving ? "Mengirim..." : "Kumpulkan"}
                  </button>
                </div>
              </div>
            )}

            {!isOpen && (assignment.textAnswer || assignment.fileUrl) && (
              <div className="p-3 bg-gray-50 rounded-xl space-y-1.5">
                <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Jawabanmu</p>
                {assignment.textAnswer && (
                  <p className="text-[11px] text-gray-700 whitespace-pre-wrap">{assignment.textAnswer}</p>
                )}
                {assignment.fileUrl && (
                  <a
                    href={assignment.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:underline"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {assignment.fileName || "Lihat lampiran"}
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function StudentAssignmentsPage() {
  return (
    <StudentShell title="Tugas" subtitle="Daftar tugas dan status pengumpulanmu">
      {(profile) => <AssignmentsContent profile={profile} />}
    </StudentShell>
  );
}
