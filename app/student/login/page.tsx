"use client";

import React, { useEffect, useRef, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import { GraduationCap, KeyRound, ArrowRight, ArrowLeft } from "lucide-react";
import { useStudentAuth, StudentProfile } from "@/src/context/StudentAuthContext";
import * as studentAuthController from "@/lib/controllers/studentAuthController";
import { describeAuthError } from "@/lib/utils/authErrors";

export default function StudentLoginPage() {
  const { user, profile, loading, applyProfile } = useStudentAuth();
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const warmupRef = useRef<ReturnType<typeof signInAnonymously> | null>(null);

  useEffect(() => {
    if (!loading && profile) {
      router.push("/student");
    }
  }, [loading, profile, router]);

  useEffect(() => {
    // Sign-in anonim + negosiasi transport Firestore pertama kali bisa
    // berat di WiFi sekolah/data seluler (lihat komentar di
    // src/config/firebase.ts). Mulai di sini, sambil siswa masih mengetik
    // kode akses, supaya waktunya tidak menumpuk semua di titik klik
    // "Masuk" — itulah yang bikin tombolnya terasa berputar amat lama.
    if (auth.currentUser || warmupRef.current) return;
    const signInPromise = signInAnonymously(auth);
    warmupRef.current = signInPromise;
    signInPromise
      .then(() => studentAuthController.warmupConnection())
      .catch(() => {
        // Diamkan — handleSubmit yang mencoba lagi nanti akan
        // menampilkan error sesungguhnya kalau memang gagal.
      });
  }, []);

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
      const currentUser = auth.currentUser ?? (await (warmupRef.current ?? signInAnonymously(auth))).user;
      const claimedProfile = await studentAuthController.claimAccessCode(accessCode, currentUser.uid);
      applyProfile(currentUser, claimedProfile as StudentProfile);
      router.push("/student");
    } catch (err: any) {
      console.error("Gagal masuk sebagai siswa:", err);
      setError(describeAuthError(err, "Gagal masuk. Periksa kembali kode akses dari gurumu."));
      warmupRef.current = null;
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || (user && profile)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-nb-workspace gap-3">
        <div className="w-10 h-10 bg-nb-green rounded-2xl flex items-center justify-center animate-pulse shadow-lg shadow-nb-green/20">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        <p className="text-xs font-bold text-nb-ink-muted tracking-wide">Memeriksa sesi...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-nb-workspace p-6">
      <div className="w-full max-w-sm space-y-6">
        <a href="/login" className="inline-flex items-center gap-1.5 text-xs font-bold text-nb-ink-muted hover:text-nb-ink">
          <ArrowLeft className="w-4 h-4" />
          Kembali
        </a>

        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-nb-green rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-nb-green/20">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-lg font-extrabold text-nb-ink">Student Companion</h1>
          <p className="text-xs text-nb-ink-muted">Masukkan kode akses yang diberikan gurumu</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-nb-paper p-6 rounded-3xl border border-nb-rule shadow-sm space-y-4">
          <div>
            <label className="text-xs font-bold text-nb-ink block mb-1">Kode Akses</label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-nb-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                placeholder="CONTOH: AB12CD34"
                autoCapitalize="characters"
                className="w-full pl-10 pr-3 py-3 bg-nb-paper border border-nb-control rounded-xl text-sm font-bold tracking-widest text-nb-ink outline-none focus:bg-nb-paper focus:ring-2 focus:ring-nb-green"
              />
            </div>
          </div>

          {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-3 rounded-xl">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 bg-nb-green hover:bg-nb-green-strong disabled:bg-[#DDE3D8] disabled:text-[#5D665E] text-white shadow-sm"
          >
            <span>{submitting ? "Memeriksa..." : "Masuk"}</span>
            {!submitting && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <p className="text-center text-xs text-nb-ink-muted">
          Belum punya kode akses? Minta ke gurumu di kelas.
        </p>
      </div>
    </div>
  );
}
