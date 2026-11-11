import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { shiftWitaDateString, getWitaDateString, getDayNameFromDateString } from '../../lib/utils/witaDate';

// Mengisi Firestore EMULATOR dengan data sekolah besar yang realistis (bentuk dokumen sama dengan yang ditulis aplikasi).
export type SchoolSize = {
  classes: number;
  studentsPerClass: number;
  teachers: number;
  schoolDays: number; // hari sekolah ke belakang (satu tahun ajaran ≈ 180)
  lessonsPerClassPerDay: number;
  assignmentsPerClass: number;
  columnsPerClass: number;
  announcementsPerClass: number;
  submissionRate: number;
};

export const LARGE_SCHOOL: SchoolSize = {
  classes: 36, studentsPerClass: 36, teachers: 60, schoolDays: 180, lessonsPerClassPerDay: 4,
  assignmentsPerClass: 25, columnsPerClass: 12, announcementsPerClass: 10, submissionRate: 0.8,
};

export function scaled(size: SchoolSize, scale: number): SchoolSize {
  const s = (n: number, min = 1) => Math.max(min, Math.round(n * scale));
  return { ...size, classes: s(size.classes, 2), teachers: s(size.teachers, 2), schoolDays: s(size.schoolDays, 10), assignmentsPerClass: s(size.assignmentsPerClass, 2) };
}

export type SeedResult = { workspaceId: string; docs: Record<string, number>; total: number; sampleClass: string; sampleStudentId: string; sampleAssignmentId: string; className: (i: number) => string };

export async function seedSchool(projectId: string, size: SchoolSize, workspaceId = 'ws-large'): Promise<SeedResult> {
  const app = getApps()[0] ?? initializeApp({ projectId });
  const db = getFirestore(app);
  const writer = db.bulkWriter();
  writer.onWriteError((e) => e.failedAttempts < 5);

  const docs: Record<string, number> = {};
  const put = (col: string, id: string, data: Record<string, unknown>) => {
    void writer.set(db.collection(col).doc(id), { workspaceId, ...data });
    docs[col] = (docs[col] ?? 0) + 1;
  };

  const today = getWitaDateString();
  const schoolDays: string[] = [];
  for (let back = 0; schoolDays.length < size.schoolDays && back < size.schoolDays * 3; back++) {
    const d = shiftWitaDateString(today, -back);
    const name = getDayNameFromDateString(d);
    if (name !== 'Sabtu' && name !== 'Minggu') schoolDays.push(d);
  }
  const weekdays = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
  const slots = ['07:00-07:45', '07:45-08:30', '08:30-09:15', '09:30-10:15', '10:15-11:00', '11:00-11:45'];
  const subjects = ['Matematika', 'IPA', 'Bahasa Indonesia', 'Bahasa Inggris', 'IPS', 'PJOK'];
  const className = (i: number) => `KELAS-${String(i + 1).padStart(2, '0')}`;

  let sampleStudentId = '';
  let sampleAssignmentId = '';

  for (let c = 0; c < size.classes; c++) {
    const cls = className(c);
    const studentIds: { id: string; name: string; nis: string }[] = [];
    for (let s = 0; s < size.studentsPerClass; s++) {
      const id = `st-${c}-${s}`;
      const st = { id, name: `Siswa ${c + 1}-${s + 1}`, nis: String(100000 + c * 100 + s) };
      studentIds.push(st);
      if (!sampleStudentId && c === 0 && s === 0) sampleStudentId = id;
      put('students', id, { className: cls, name: st.name, nis: st.nis, accessCode: `AC${c}${s}`.padEnd(8, 'X'), createdBy: 'owner' });
    }

    // Jadwal mingguan: tiap hari `lessonsPerClassPerDay` slot
    const scheduleIds: string[] = [];
    weekdays.forEach((day, di) => {
      for (let l = 0; l < size.lessonsPerClassPerDay; l++) {
        const id = `sch-${c}-${di}-${l}`;
        scheduleIds.push(id);
        put('schedules', id, { day, timeSlot: slots[(l + di) % slots.length], className: cls, subject: subjects[(c + l + di) % subjects.length], createdBy: `t${c % size.teachers}` });
      }
    });

    // Presensi + jurnal: tiap hari sekolah x tiap jam pelajaran kelas ini
    for (const date of schoolDays) {
      const dayName = getDayNameFromDateString(date);
      const di = weekdays.indexOf(dayName);
      for (let l = 0; l < size.lessonsPerClassPerDay; l++) {
        const scheduleId = `sch-${c}-${di}-${l}`;
        const subject = subjects[(c + l + di) % subjects.length];
        put('attendances', `att-${c}-${date}-${l}`, {
          className: cls, date, scheduleId, subject, isCompleted: true, createdBy: `t${c % size.teachers}`,
          details: studentIds.map((st, i) => ({ studentId: st.id, name: st.name, nis: st.nis, status: i % 17 === 0 ? 'Sakit' : 'Hadir', late: i % 11 === 0 })),
          summary: { hadir: size.studentsPerClass - 2, sakit: 2, izin: 0, alpa: 0, terlambat: 3 },
        });
        put('journals', `jr-${c}-${date}-${l}`, {
          className: cls, date, scheduleId, subject, topic: `Materi ${subject} pertemuan ${date}`, notes: 'Catatan mengajar contoh. '.repeat(6), createdBy: `t${c % size.teachers}`,
        });
      }
    }

    // Kolom nilai + nilai
    const columnIds: string[] = [];
    for (let k = 0; k < size.columnsPerClass; k++) {
      const id = `col-${c}-${k}`;
      columnIds.push(id);
      put('grade_columns', id, { className: cls, title: k < 4 ? `Ulangan ${k + 1}` : `Tugas ${k - 3}`, type: k < 4 ? 'Ulangan' : 'Tugas', createdBy: `t${c % size.teachers}` });
    }
    for (const st of studentIds) for (const colId of columnIds) put('grades', `${st.id}_${colId}`, { className: cls, studentId: st.id, columnId: colId, score: String(60 + ((st.id.length + colId.length) % 40)) });

    // Tugas + pengumpulan (tenggat tersebar di tahun ajaran)
    for (let a = 0; a < size.assignmentsPerClass; a++) {
      const id = `as-${c}-${a}`;
      if (!sampleAssignmentId && c === 0 && a === 0) sampleAssignmentId = id;
      const dueDate = schoolDays[Math.min(schoolDays.length - 1, Math.floor((a / size.assignmentsPerClass) * schoolDays.length))];
      put('assignments', id, { className: cls, subject: subjects[a % subjects.length], title: `Tugas ${a + 1} ${cls}`, description: 'Kerjakan soal pada halaman yang ditentukan.', dueDate, gradeColumnId: columnIds[4 + (a % (size.columnsPerClass - 4 || 1))] ?? columnIds[0], createdBy: `t${c % size.teachers}` });
      studentIds.forEach((st, i) => {
        if ((i + a) % 10 >= size.submissionRate * 10) return;
        put('submissions', `${id}_${st.id}`, {
          assignmentId: id, studentId: st.id, className: cls, status: 'menunggu_penilaian', textAnswer: 'Jawaban siswa contoh. '.repeat(10),
          attachments: [{ fileUrl: `supabase-storage://submission-attachments/submissions/${workspaceId}/${id}/u/${st.id}.jpg`, fileName: 'foto.jpg', filePath: `submissions/${workspaceId}/${id}/u/${st.id}.jpg` }],
          submittedAt: `${dueDate}T08:00:00.000Z`,
        });
      });
    }

    for (let n = 0; n < size.announcementsPerClass; n++) put('announcements', `an-${c}-${n}`, { className: cls, date: schoolDays[n * 3] ?? today, title: `Pengumuman ${n + 1}`, body: 'Isi pengumuman contoh.', createdBy: `t${c % size.teachers}` });
  }

  await writer.close();
  const total = Object.values(docs).reduce((a, b) => a + b, 0);
  return { workspaceId, docs, total, sampleClass: className(0), sampleStudentId, sampleAssignmentId, className };
}
