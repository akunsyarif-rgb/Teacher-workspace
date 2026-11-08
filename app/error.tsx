"use client";

import { useEffect } from "react";
import ErrorScreen, { primaryActionClass, secondaryActionClass } from "@/src/components/ui/ErrorScreen";

// Menangkap galat saat render di segmen mana pun di bawah layout root, supaya
// pengguna tidak melihat layar putih. Pesan error asli TIDAK ditampilkan (di
// produksi Next.js sudah menyamarkannya jadi `digest`); hanya kode referensi.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Kesalahan tampilan:", error.digest ?? "tanpa-digest");
  }, [error]);

  return (
    <ErrorScreen
      title="Terjadi kesalahan"
      message="Halaman ini gagal ditampilkan. Data Anda aman. Coba muat ulang, atau kembali ke beranda."
      reference={error.digest}
    >
      <button type="button" onClick={() => reset()} className={primaryActionClass}>
        Coba lagi
      </button>
      <a href="/" className={secondaryActionClass}>
        Ke beranda
      </a>
    </ErrorScreen>
  );
}
