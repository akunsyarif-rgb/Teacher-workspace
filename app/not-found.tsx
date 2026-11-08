import ErrorScreen, { primaryActionClass } from "@/src/components/ui/ErrorScreen";

export default function NotFound() {
  return (
    <ErrorScreen
      title="Halaman tidak ditemukan"
      message="Alamat yang Anda buka tidak ada atau sudah dipindahkan."
    >
      <a href="/" className={primaryActionClass}>
        Ke beranda
      </a>
    </ErrorScreen>
  );
}
