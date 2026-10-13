"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Info } from "lucide-react";
import StudentShell from "@/src/components/student/StudentShell";

const NOTEBOOK_LM_URL = "https://notebook.google.com/notebook/048a08e5-7f96-4731-9839-2c6353cb523f";

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

      <div className="bg-nb-paper rounded-2xl border border-nb-rule shadow-sm overflow-hidden">
        <div className="p-3 border-b border-nb-rule flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-nb-ink">NotebookLM</h2>
            <p className="text-xs text-nb-ink-muted mt-0.5">Preview di dalam Teacher Workspace</p>
          </div>
          <a
            href={NOTEBOOK_LM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-nb-green text-white text-xs font-bold hover:opacity-90 shrink-0"
          >
            Buka di browser
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>

        <div className="p-3 bg-amber-50 border-b border-amber-100 flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-amber-900">
            Jika preview kosong atau Google meminta membuka halaman di browser, gunakan tombol “Buka di browser”. Beberapa layanan membatasi pemuatan di dalam frame.
          </p>
        </div>

        <iframe
          title="NotebookLM preview"
          src={NOTEBOOK_LM_URL}
          className="block w-full bg-white"
          style={{ height: "72vh", minHeight: "520px" }}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="clipboard-read; clipboard-write"
        />
      </div>
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
