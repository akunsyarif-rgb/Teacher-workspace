import Link from "next/link";
import ErrorScreen, { primaryActionClass } from "@/src/components/ui/ErrorScreen";

export default function NotFound() {
  return (
    <ErrorScreen
      title="Halaman tidak ditemukan"
      message="Alamat yang Anda buka tidak ada atau sudah dipindahkan."
    >
      <Link href="/" className={primaryActionClass}>
        Ke beranda
      </Link>
    </ErrorScreen>
  );
}
