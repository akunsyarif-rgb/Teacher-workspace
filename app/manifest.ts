import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Teacher Workspace",
    short_name: "Workspace",
    description: "Pusat operasional guru: jurnal mengajar, presensi, nilai, tugas, dan jadwal kelas.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F7F5EF",
    theme_color: "#F7F5EF",
    lang: "id",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
