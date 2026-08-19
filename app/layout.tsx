import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import BottomNav from "@/src/components/BottomNav";
import OfflineBanner from "@/src/components/ui/OfflineBanner";
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
          <div className="flex-1 pb-20">{children}</div>
          <BottomNav />
        </WorkspaceProvider>
      </body>
    </html>
  );
}