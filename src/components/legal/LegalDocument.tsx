import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LEGAL_DRAFT, LEGAL_PATHS, LEGAL_UPDATED_AT, LEGAL_VERSION } from '@/lib/config/legal';

export type LegalSection = { heading: string; paragraphs?: string[]; items?: string[] };

// Tata letak bersama untuk halaman hukum (publik, tanpa login).
export default function LegalDocument({ title, intro, sections, other }: {
  title: string;
  intro: string;
  sections: LegalSection[];
  other: { href: string; label: string };
}) {
  return (
    <main className="min-h-screen bg-nb-workspace p-4 sm:p-6 md:p-10 pb-24">
      <article className="max-w-2xl mx-auto space-y-6">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-bold text-nb-ink-muted hover:text-nb-ink">
          <ArrowLeft className="w-4 h-4" /> Kembali
        </Link>

        <header className="space-y-2">
          <h1 className="text-2xl font-extrabold text-nb-ink">{title}</h1>
          <p className="text-xs text-nb-ink-muted">Versi {LEGAL_VERSION} · Diperbarui {LEGAL_UPDATED_AT}</p>
        </header>

        {LEGAL_DRAFT && (
          <div role="note" data-testid="legal-draft-banner" className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800">
            DRAF — dokumen ini belum ditinjau ahli hukum dan masih memuat placeholder [dalam kurung siku]. Jangan dipublikasikan sebagai versi final.
          </div>
        )}

        <p className="text-sm text-nb-ink leading-relaxed">{intro}</p>

        <div className="space-y-6">
          {sections.map((s, i) => (
            <section key={s.heading} className="space-y-2">
              <h2 className="text-base font-extrabold text-nb-ink">{i + 1}. {s.heading}</h2>
              {s.paragraphs?.map((p) => (
                <p key={p} className="text-sm text-nb-ink leading-relaxed">{p}</p>
              ))}
              {s.items && (
                <ul className="list-disc pl-5 space-y-1 text-sm text-nb-ink leading-relaxed">
                  {s.items.map((it) => <li key={it}>{it}</li>)}
                </ul>
              )}
            </section>
          ))}
        </div>

        <footer className="pt-4 border-t border-nb-rule text-xs text-nb-ink-muted flex flex-wrap gap-x-4 gap-y-1">
          <Link href={other.href} className="font-bold text-nb-green hover:underline">{other.label}</Link>
          <Link href={LEGAL_PATHS.privacy} className="hover:underline">Kebijakan Privasi</Link>
          <Link href={LEGAL_PATHS.terms} className="hover:underline">Syarat dan Ketentuan</Link>
        </footer>
      </article>
    </main>
  );
}
