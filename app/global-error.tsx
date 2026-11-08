"use client";

import { useEffect } from "react";

// Dipakai HANYA bila layout root sendiri yang crash — menggantikan seluruh <html>,
// jadi tidak bisa bergantung pada CSS/komponen aplikasi (globals.css tidak termuat):
// semua gaya inline. Tidak menampilkan pesan error; hanya kode referensi (digest).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Kesalahan fatal tampilan:", error.digest ?? "tanpa-digest");
  }, [error]);

  const button = {
    border: "none",
    borderRadius: 12,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    background: "#16a34a",
    color: "#fff",
  } as const;

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#fafaf7",
          color: "#1f2937",
        }}
      >
        <h1 style={{ fontSize: 18, margin: 0 }}>Aplikasi mengalami masalah</h1>
        <p style={{ fontSize: 14, margin: 0, maxWidth: 360, color: "#4b5563" }}>
          Terjadi kesalahan tak terduga. Data Anda aman. Coba muat ulang halaman.
        </p>
        {error.digest ? (
          <p style={{ fontSize: 12, margin: 0, color: "#6b7280" }}>
            Kode referensi: <code>{error.digest}</code>
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" style={button} onClick={() => reset()}>
            Coba lagi
          </button>
          <a href="/" style={{ ...button, background: "transparent", color: "#1f2937", border: "1px solid #d1d5db", textDecoration: "none" }}>
            Ke beranda
          </a>
        </div>
      </body>
    </html>
  );
}
