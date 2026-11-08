"use client";

import { useEffect } from "react";
import ErrorScreen, { primaryActionClass, secondaryActionClass } from "@/src/components/ui/ErrorScreen";

// Sama seperti app/error.tsx, tetapi tautan pulangnya ke beranda siswa.
export default function StudentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Kesalahan tampilan (siswa):", error.digest ?? "tanpa-digest");
  }, [error]);

  return (
    <ErrorScreen
      title="Terjadi kesalahan"
      message="Halaman ini gagal ditampilkan. Pekerjaan yang sudah tersimpan tetap aman. Coba lagi, atau kembali ke beranda."
      reference={error.digest}
    >
      <button type="button" onClick={() => reset()} className={primaryActionClass}>
        Coba lagi
      </button>
      <a href="/student" className={secondaryActionClass}>
        Ke beranda siswa
      </a>
    </ErrorScreen>
  );
}
