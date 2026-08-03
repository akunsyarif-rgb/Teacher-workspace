"use client";

import React, { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/src/config/firebase";
import { Save, BookOpen, CheckCircle2, AlertCircle } from "lucide-react";

export default function JournalForm() {
  const [className, setClassName] = useState("X-1");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    setErrorMessage("");

    try {
      await addDoc(collection(db, "journals"), {
        className,
        subject,
        topic,
        notes,
        createdAt: serverTimestamp(),
      });

      setSuccess(true);
      setSubject("");
      setTopic("");
      setNotes("");
    } catch (error: any) {
      console.error("Gagal menyimpan jurnal:", error);
      setErrorMessage("Gagal menyimpan: " + (error.message || "Periksa koneksi atau izin database."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
          <BookOpen className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Form Jurnal Mengajar</h2>
          <p className="text-xs text-gray-500">Catat aktivitas pembelajaran kelas hari ini</p>
        </div>
      </div>

      {success && (
        <div className="mb-4 p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Jurnal berhasil disimpan ke Firestore!</span>
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1.5">Pilih Kelas</label>
            <select
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:bg-white focus:ring-2 focus:ring-blue-600 outline-none"
            >
              <option value="X-1">X-1</option>
              <option value="X-2">X-2</option>
              <option value="XI-1">XI-1</option>
              <option value="XII-1">XII-1</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1.5">Mata Pelajaran</label>
            <input
              type="text"
              placeholder="Contoh: Informatika / Fisika"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-blue-600 outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1.5">Materi / Topik Pembelajaran</label>
          <input
            type="text"
            placeholder="Contoh: Algoritma Pemrograman & Flowchart"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-blue-600 outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1.5">Catatan Kelas / Hambatan (Opsional)</label>
          <textarea
            rows={3}
            placeholder="Catatan diskusi, kelompok yang aktif, atau siswa yang izin..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-blue-600 outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 mt-2"
        >
          <Save className="w-4 h-4" />
          <span>{loading ? "Menyimpan..." : "Simpan Jurnal"}</span>
        </button>
      </form>
    </div>
  );
}
