"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, BookOpen, Info } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";

const NOTEBOOK_LM_URL = "https://notebook.google.com/notebook/0dd94122-4449-46f9-b9a8-d9096bc28076";

function NotebookContent() {
  return (
    <div className="space-y-3">
      <Link
        href="/student"
        className="inline-flex items-center gap-2 text-sm font-semibold text-nb-green hover:underline"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Kembali ke halaman siswa
      </Link>

      <section className="bg-nb-paper rounded-2xl border border-nb-rule shadow-sm p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-nb-green-soft text-nb-green flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-bold text-nb-ink">NotebookLM</h2>
            <p className="text-sm text-nb-ink-muted mt-1">
              Buka notebook pembelajaran ini menggunakan akun Google yang sudah memiliki akses.
            </p>
          </div>
        </div>

        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-amber-900">
            NotebookLM berhasil dibuka melalui browser, tetapi tidak tampil di preview dalam halaman ini. Untuk memastikan chat dan login berfungsi, buka NotebookLM langsung. Setelah selesai, gunakan tombol kembali di browser untuk kembali ke Teacher Workspace.
          </p>
        </div>

        <a
          href={NOTEBOOK_LM_URL}
          className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 rounded-xl bg-nb-green text-white text-sm font-semibold hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-green transition-opacity"
        >
          Buka NotebookLM
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
        </a>

        <p className="text-xs text-nb-ink-muted">
          Jika diminta login, pilih akun Google siswa yang memiliki akses ke notebook.
        </p>
      </section>
    </div>
  );
}

export default function StudentNotebookLMPage() {
  return (
    <StudentShell title="Ruang Notebook LLM" subtitle="Belajar dengan NotebookLM">
      {() => <NotebookContent />}
    </StudentShell>
  );
}
