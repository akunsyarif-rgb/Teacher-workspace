import * as journalRepository from '../repositories/journalRepository';

export async function listJournalEntries(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return journalRepository.getJournalsByClass(workspaceId, className);
}

function todayDateString() {
  return new Date().toISOString().split('T')[0];
}

// Dipanggil saat tab Jurnal dibuka — menentukan status "○ Belum diisi" vs
// "✓ Tersimpan" untuk sesi hari ini, dan mengisi ulang form kalau guru
// menekan Edit.
export async function loadTodayJournal(workspaceId: string, className: string, scheduleId?: string | null) {
  if (!workspaceId || !className) return null;
  return journalRepository.findTodayJournal(workspaceId, className, scheduleId ?? null, todayDateString());
}

// Jurnal TIDAK auto-save (beda dari Presensi) — guru menekan Simpan
// secara sadar, boleh di awal/tengah/akhir KBM. existingId null berarti
// entri baru (belum pernah diisi hari ini); kalau ada, ini adalah edit
// atas entri yang sudah tersimpan (audit "Perencanaan Workflow Dalam
// Kelas" — jurnal harus bisa "diperbaiki kapan saja" lewat Edit, bukan
// cuma hapus-lalu-tulis-ulang).
export async function saveJournalEntry(
  existingId: string | null,
  workspaceId: string,
  className: string,
  subject: string,
  data: { topic: string; notes: string },
  scheduleId?: string | null
) {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  if (!className) throw new Error('Kelas tidak valid.');
  if (!data.topic || !data.topic.trim()) {
    throw new Error('Materi wajib diisi.');
  }
  const payload = {
    workspaceId,
    className,
    subject: subject.trim(),
    topic: data.topic.trim(),
    notes: data.notes?.trim() || '-',
    date: todayDateString(),
    scheduleId: scheduleId ?? null,
  };
  if (existingId) {
    await journalRepository.updateJournal(existingId, payload);
    return { id: existingId, ...payload };
  }
  return journalRepository.createJournal(payload);
}

export async function removeJournalEntry(id: string) {
  return journalRepository.deleteJournal(id);
}
