import React from 'react';
import Link from 'next/link';
import { LEGAL_PATHS } from '@/lib/config/legal';

// Tautan hukum untuk footer halaman publik (login, daftar, masuk siswa) dan Akun.
export default function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Informasi hukum" className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-nb-ink-muted ${className}`}>
      <Link href={LEGAL_PATHS.privacy} className="hover:underline hover:text-nb-ink">Kebijakan Privasi</Link>
      <span aria-hidden>·</span>
      <Link href={LEGAL_PATHS.terms} className="hover:underline hover:text-nb-ink">Syarat dan Ketentuan</Link>
    </nav>
  );
}
