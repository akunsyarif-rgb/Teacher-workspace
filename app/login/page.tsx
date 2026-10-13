"use client";

import React, { useState, useEffect } from "react";
import { signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import { GraduationCap, Lock, Mail, ArrowRight, Users, BookOpen, ChevronLeft } from "lucide-react";
import { describeAuthError } from "@/lib/utils/authErrors";

type LoginPath = "student" | "teacher";

export default function LoginPage() {
  const [path, setPath] = useState<LoginPath | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.push("/");
      } else {
        setCheckingSession(false);
      }
    });
    return () => unsubscribe();
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResetMessage("");
    if (!email || !password) {
      setError("Email dan kata sandi wajib diisi.");
      return;
    }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.push("/");
    } catch (err: any) {
      console.error("Gagal login:", err);
      setError(describeAuthError(err, "Email atau kata sandi salah. Silakan periksa kembali."));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError("");
    setResetMessage("");
    if (!email) {
      setError('Isi email Anda dulu, lalu tap "Lupa kata sandi?" lagi.');
      return;
    }

    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetMessage("Link reset kata sandi sudah dikirim ke email Anda. Cek juga folder Spam.");
    } catch (err: any) {
      console.error("Gagal mengirim reset password:", err);
      setError(describeAuthError(err, "Gagal mengirim email reset. Periksa kembali alamat email Anda."));
    } finally {
      setResetLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-nb-workspace gap-3">
        <div className="w-10 h-10 bg-nb-green rounded-2xl flex items-center justify-center animate-pulse shadow-lg shadow-nb-green/20">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        <p className="text-sm font-semibold text-nb-ink-muted tracking-wide">Memeriksa sesi...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-nb-workspace flex items-center justify-center p-4 sm:p-6">
      <section className="max-w-xl w-full bg-nb-paper p-5 sm:p-8 rounded-3xl shadow-sm border border-nb-rule space-y-6">
        <header className="flex flex-col items-center text-center space-y-2">
          <div className="w-14 h-14 bg-nb-green rounded-2xl flex items-center justify-center shadow-md shadow-nb-green/20">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-nb-green">Buku Catatan Digital</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-nb-ink">Teacher Workspace</h1>
          <p className="text-sm text-nb-ink-muted max-w-sm">
            Ruang belajar dan kerja kelas yang tertata. Pilih jalur masuk sesuai peran Anda.
          </p>
        </header>

        {path === null ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => router.push("/student/login")}
              className="group min-h-36 text-left p-5 rounded-2xl border border-nb-rule bg-nb-green-soft hover:border-nb-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-green transition-colors"
            >
              <span className="w-11 h-11 rounded-xl bg-nb-green text-white flex items-center justify-center mb-4">
                <Users className="w-5 h-5" />
              </span>
              <span className="block text-base font-bold text-nb-ink">Masuk sebagai Siswa</span>
              <span className="block text-sm text-nb-ink-muted mt-1">Gunakan kode akses dari guru untuk membuka ruang kelas.</span>
              <span className="flex items-center gap-1 text-sm font-bold text-nb-green mt-4">
                Masuk siswa <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setPath("teacher"); setError(""); setResetMessage(""); }}
              className="group min-h-36 text-left p-5 rounded-2xl border border-nb-rule bg-nb-paper hover:border-nb-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-green transition-colors"
            >
              <span className="w-11 h-11 rounded-xl bg-nb-highlight text-nb-ink flex items-center justify-center mb-4">
                <BookOpen className="w-5 h-5" />
              </span>
              <span className="block text-base font-bold text-nb-ink">Masuk sebagai Guru</span>
              <span className="block text-sm text-nb-ink-muted mt-1">Kelola workspace, kelas, jurnal, dan kegiatan belajar.</span>
              <span className="flex items-center gap-1 text-sm font-bold text-nb-green mt-4">
                Masuk guru <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => { setPath(null); setError(""); setResetMessage(""); }}
              className="inline-flex items-center gap-1 text-sm font-semibold text-nb-green hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-green rounded"
            >
              <ChevronLeft className="w-4 h-4" /> Kembali ke pilihan masuk
            </button>
            <div>
              <h2 className="text-xl font-bold text-nb-ink">Masuk sebagai Guru</h2>
              <p className="text-sm text-nb-ink-muted mt-1">Gunakan email dan kata sandi akun Teacher Workspace Anda.</p>
            </div>

            {error && (
              <div role="alert" className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-sm font-semibold text-red-700">
                {error}
              </div>
            )}
            {resetMessage && (
              <div role="status" className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm font-semibold text-emerald-800">
                {resetMessage}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="teacher-email" className="block text-sm font-semibold text-nb-ink-muted">Email akun</label>
                <div className="relative">
                  <Mail aria-hidden="true" className="w-4 h-4 text-nb-ink-muted absolute left-3.5 top-4" />
                  <input
                    id="teacher-email"
                    type="email"
                    autoComplete="username"
                    placeholder="nama@sekolah.sch.id"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3.5 bg-nb-paper border border-nb-control rounded-xl text-base text-nb-ink outline-none focus-visible:ring-2 focus-visible:ring-nb-green"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="teacher-password" className="text-sm font-semibold text-nb-ink-muted">Kata sandi</label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={resetLoading}
                    className="text-sm font-semibold text-nb-green hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-green rounded disabled:opacity-60"
                  >
                    {resetLoading ? "Mengirim..." : "Lupa kata sandi?"}
                  </button>
                </div>
                <div className="relative">
                  <Lock aria-hidden="true" className="w-4 h-4 text-nb-ink-muted absolute left-3.5 top-4" />
                  <input
                    id="teacher-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Masukkan kata sandi"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3.5 bg-nb-paper border border-nb-control rounded-xl text-base text-nb-ink outline-none focus-visible:ring-2 focus-visible:ring-nb-green"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-4 bg-nb-green hover:bg-nb-green-strong text-white rounded-xl text-base font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-green disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <span>{loading ? "Memproses..." : "Masuk ke Workspace"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        <footer className="border-t border-nb-rule pt-5 text-center">
          <p className="text-sm text-nb-ink-muted">
            Belum punya akun guru?{" "}
            <a href="/signup" className="font-bold text-nb-green hover:underline">Buat akun Teacher Workspace</a>
          </p>
        </footer>
      </section>
    </main>
  );
}
