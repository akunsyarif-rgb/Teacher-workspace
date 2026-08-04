import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { STATUS_LETTER } from './attendanceStatus';

type AttendanceSession = {
  date: string;
  details?: { studentId: string; status: string }[];
};

type StudentLike = { id: string; name: string; nis?: string };

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// Membentuk PDF rekap presensi (siswa x pertemuan) dari data yang sudah
// ada di layar (students + history) — tidak perlu query tambahan. Ini
// mewujudkan tabel rekap penuh yang sebelumnya ditunda sebagai "laporan
// terpisah" saat strip riwayat singkat dibangun di layar presensi harian.
export function exportAttendanceRecapPdf(params: {
  className: string;
  subject: string;
  students: StudentLike[];
  history: AttendanceSession[];
}) {
  const { className, subject, students, history } = params;
  const sortedHistory = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const doc = new jsPDF({ orientation: sortedHistory.length > 10 ? 'landscape' : 'portrait' });

  doc.setFontSize(13);
  doc.text(`Rekap Presensi Kelas ${className}`, 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Mata Pelajaran: ${subject || '-'}`, 14, 21);
  doc.text(
    `Dicetak: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    14,
    26
  );
  doc.setTextColor(0);

  const recapKeys = ['H', 'T', 'S', 'I', 'D', 'A'];
  const head = [['No', 'Nama Siswa', ...sortedHistory.map((h) => formatShortDate(h.date)), ...recapKeys]];

  const body = students.map((student, idx) => {
    const counts: Record<string, number> = { H: 0, T: 0, S: 0, I: 0, D: 0, A: 0 };
    const cells = sortedHistory.map((session) => {
      const detail = (session.details || []).find((d) => d.studentId === student.id);
      if (!detail) return '-';
      const letter = STATUS_LETTER[detail.status] || '?';
      if (counts[letter] !== undefined) counts[letter] += 1;
      return letter;
    });
    return [idx + 1, student.name, ...cells, ...recapKeys.map((k) => counts[k])];
  });

  autoTable(doc, {
    startY: 32,
    head,
    body,
    styles: { fontSize: 7, cellPadding: 1.5, halign: 'center' },
    columnStyles: { 1: { halign: 'left', cellWidth: 35 } },
    headStyles: { fillColor: [37, 99, 235], halign: 'center' },
  });

  doc.save(`Rekap-Presensi-${className}-${new Date().toISOString().split('T')[0]}.pdf`);
}
