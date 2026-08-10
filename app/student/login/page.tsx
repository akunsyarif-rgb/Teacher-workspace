"use client";

import React, { useEffect, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import { GraduationCap, KeyRound, ArrowRight, ArrowLeft } from "lucide-react";
import { useStudentAuth, StudentProfile } from "@/src/context/StudentAuthContext";
import * as studentAuthController from "@/lib/controllers/studentAuthController";

export default function StudentLoginPage() {
  const { user, profile, loading, applyProfile } = useStudentAuth();
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!loading && profile) {
      router.push("/student");
    }
  }, [loading, profile, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!accessCode.trim()) {
      setError("Kode akses wajib diisi.");
      return;
    }

    // Kalau ada sesi guru (email/password) yang masih login di perangkat
    // ini, jangan diam-diam ditimpa oleh sesi anonim siswa.
    if (auth.currentUser && !auth.currentUser.isAnonymous) {
      setError("Perangkat ini sedang login sebagai guru. Keluar dari akun guru dulu sebelum masuk sebagai siswa.");
      return;
    }

    setSubmitting(true);
    try {
      const currentUser = auth.currentUser ?? (await signInAnonymously(auth)).user;
      const claimedProfile = await studentAuthController.claimAccessCode(accessCode, currentUser.uid);
      applyProfile(currentUser, claimedProfile as StudentProfile);
      router.push("/student");
    } catch (err: any) {
      console.error("Gagal masuk sebagai siswa:", err);
      setError(err.message || "Gagal masuk. Periksa kembali kode akses dari gurumu.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || (user && profile)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center animate-pulse shadow-lg shadow-blue-200">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        <p className="text-xs font-bold text-gray-500 tracking-wide">Memeriksa sesi...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm space-y-6">
        <a href="/login" className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" />
          Kembali
        </a>

        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-200">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-lg font-extrabold text-gray-900">Student Companion</h1>
          <p className="text-xs text-gray-500">Masukkan kode akses yang diberikan gurumu</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Kode Akses</label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                placeholder="CONTOH: AB12CD34"
                autoCapitalize="characters"
                className="w-full pl-10 pr-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold tracking-widest text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-3 rounded-xl">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white shadow-sm"
          >
            <span>{submitting ? "Memeriksa..." : "Masuk"}</span>
            {!submitting && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <p className="text-center text-[11px] text-gray-400">
          Belum punya kode akses? Minta ke gurumu di kelas.
        </p>
      </div>
    </div>
  );
}
