"use client";

import React, { useState, useEffect } from "react";
import { signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/src/config/firebase";
import { useRouter } from "next/navigation";
import { GraduationCap, Lock, Mail, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Firebase Auth sudah otomatis menyimpan & memulihkan sesi login
    // (termasuk saat offline) tanpa perlu penyimpanan tambahan di sini.
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
      setError("Email atau kata sandi salah. Silakan periksa kembali.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError("");
    setResetMessage("");

    if (!email) {
      setError("Isi email Anda dulu, lalu tap \"Lupa kata sandi?\" lagi.");
      return;
    }

    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetMessage("Link reset kata sandi sudah dikirim ke email Anda. Cek juga folder Spam.");
    } catch (err: any) {
      console.error("Gagal mengirim reset password:", err);
      setError("Gagal mengirim email reset. Periksa kembali alamat email Anda.");
    } finally {
      setResetLoading(false);
    }
  }

  if (checkingSession) {
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-sm border border-gray-100 space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-md shadow-blue-200">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>

        <p className="text-center text-xs text-gray-400">
          Belum punya akun?{' '}
          <a href="/signup" className="text-blue-600 font-bold hover:underline">
            Daftar di sini
          </a>
        </p>
          <h1 className="text-xl font-extrabold text-gray-900 mt-2">Masuk ke Aplikasi Guru</h1>
          <p className="text-xs text-gray-400">Kelola absensi, jurnal, dan kegiatan kelas dengan mudah</p>
        </div>

        {error && (
          <div className="p-3.5 bg-red-50 border border-red-100 rounded-2xl text-xs font-bold text-red-600 text-center">
            {error}
          </div>
        )}

        {resetMessage && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-100 rounded-2xl text-xs font-bold text-emerald-700 text-center">
            {resetMessage}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Email Akun</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              <input
                type="email"
                placeholder="nama@sekolah.sch.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-extrabold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Kata Sandi</label>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={resetLoading}
                className="text-[10px] font-bold text-blue-600 hover:underline disabled:text-blue-300"
              >
                {resetLoading ? "Mengirim..." : "Lupa kata sandi?"}
              </button>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-extrabold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold shadow-md shadow-blue-200 transition-all active:scale-[0.97] flex items-center justify-center gap-2 mt-2"
          >
            <span>{loading ? "Memproses..." : "Masuk ke Beranda"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
