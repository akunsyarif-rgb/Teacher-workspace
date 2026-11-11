import type { ReactNode } from "react";

// Tampilan halaman galat/tidak ditemukan yang dipakai error.tsx, not-found.tsx
// dan student/error.tsx. Sengaja generik: TIDAK pernah menampilkan pesan error,
// stack trace, atau path — hanya `reference` (digest Next.js, hash opak) bila ada,
// supaya pengguna bisa melaporkannya tanpa membocorkan detail internal.
export default function ErrorScreen({
  title,
  message,
  reference,
  children,
}: {
  title: string;
  message: string;
  reference?: string;
  children?: ReactNode;
}) {
  return (
    <main
      role="alert"
      className="min-h-[70vh] flex flex-col items-center justify-center gap-4 p-6 text-center bg-nb-workspace"
    >
      <h1 className="text-lg font-extrabold text-nb-ink">{title}</h1>
      <p className="max-w-sm text-sm text-nb-ink-muted">{message}</p>
      {reference ? (
        <p className="text-xs text-nb-ink-muted">
          Kode referensi: <span className="font-mono">{reference}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>
    </main>
  );
}

export const primaryActionClass =
  "inline-flex items-center justify-center rounded-xl bg-nb-green px-4 py-2 text-sm font-bold text-white hover:bg-nb-green-strong focus-visible:outline-2 focus-visible:outline-offset-2";
export const secondaryActionClass =
  "inline-flex items-center justify-center rounded-xl border border-nb-control px-4 py-2 text-sm font-bold text-nb-ink hover:bg-nb-green-soft focus-visible:outline-2 focus-visible:outline-offset-2";
