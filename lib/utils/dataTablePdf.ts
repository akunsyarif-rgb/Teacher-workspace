import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type TableSection = {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
};

// PDF tabel generik untuk Download Data (Data & Arsip) — pola yang sama
// dengan attendancePdf.ts (Rekap Presensi kontekstual di Presensi →
// Riwayat), cuma kolom/judulnya dinamis supaya satu fungsi ini bisa
// dipakai untuk jurnal/presensi/nilai/tugas/pengumuman apa pun. Beberapa
// section digabung jadi SATU file PDF (bukan banyak file terpisah) —
// men-trigger banyak download sekaligus sering diblokir browser dan
// membingungkan guru.
export function exportDataTablePdf(params: {
  documentTitle: string;
  subtitle?: string;
  sections: TableSection[];
  filename: string;
}) {
  const { documentTitle, subtitle, sections, filename } = params;
  const hasWideSection = sections.some((s) => s.columns.length > 6);
  const doc = new jsPDF({ orientation: hasWideSection ? 'landscape' : 'portrait' });

  doc.setFontSize(14);
  doc.text(documentTitle, 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(100);
  if (subtitle) doc.text(subtitle, 14, 21);
  doc.text(
    `Dicetak: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    14,
    subtitle ? 26 : 21
  );
  doc.setTextColor(0);

  let cursorY = subtitle ? 34 : 29;

  sections.forEach((section, idx) => {
    if (idx > 0) {
      doc.addPage();
      cursorY = 20;
    }
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text(section.title, 14, cursorY);
    doc.setTextColor(0);

    if (section.rows.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text('Tidak ada data untuk periode/kelas ini.', 14, cursorY + 8);
      doc.setTextColor(0);
      return;
    }

    autoTable(doc, {
      startY: cursorY + 5,
      head: [section.columns.map((c) => c.label)],
      body: section.rows.map((row) => section.columns.map((c) => String(row[c.key] ?? '-'))),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235] },
    });
  });

  doc.save(filename);
}
