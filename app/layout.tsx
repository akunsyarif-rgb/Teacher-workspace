import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import BottomNav from "@/src/components/BottomNav";
import OfflineBanner from "@/src/components/ui/OfflineBanner";
import PerfOverlay from "@/src/components/ui/PerfOverlay";
import { WorkspaceProvider } from "@/src/context/WorkspaceContext"; // <-- IMPOR INI

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Teacher Workspace",
  description: "Pusat operasional guru: jurnal mengajar, presensi, nilai, tugas, dan jadwal kelas.",
  appleWebApp: { capable: true, title: "Workspace", statusBarStyle: "default" },
};

// Mode gelap belum dirancang: beri tahu browser/OS bahwa halaman hanya terang,
// supaya kontrol native dan auto-dark Safari tidak membalik warna. Zoom
// pengguna sengaja TIDAK dibatasi.
export const viewport: Viewport = {
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* BUNGKUS SELURUH APLIKASI DENGAN WORKSPACE PROVIDER */}
        <WorkspaceProvider>
          <OfflineBanner />
          <div className="flex-1 pb-20 xl:pl-56 xl:pb-0">{children}</div>
          <BottomNav />
          <PerfOverlay />
        </WorkspaceProvider>
      </body>
    </html>
  );
}