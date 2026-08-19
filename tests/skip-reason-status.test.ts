import { describe, expect, it } from 'vitest';
import { classifySessionState, resolveCurrentWorkflowStep } from '../lib/utils/scheduleTime';

// Regresi "SkipReason jadi status resmi Tidak Mengajar": sebelumnya mencatat
// alasan (Rapat/Tugas dinas/dst) TIDAK mengubah apa pun selain menambahkan
// konteks — sesi tetap "Perlu Konfirmasi" selamanya. Sekarang sesi dengan
// alasan tercatat harus keluar dari daftar pekerjaan belum selesai.

const NOW = new Date('2026-08-11T09:00:00+08:00'); // 09.00 WITA
const SESI_LEWAT_TIMESLOT = '07:00-08:00'; // sudah lewat relatif ke NOW

// Cermin persis perhitungan todayClassStatuses di dashboardService: isDone
// menang atas isSkipped (data presensi/jurnal sungguhan lebih valid
// daripada label "Tidak Mengajar").
function hitungStatusSesi(opts: { isDone: boolean; hasSkipReason: boolean; timeSlot?: string }) {
  const timeSlot = opts.timeSlot ?? SESI_LEWAT_TIMESLOT;
  const isSkipped = opts.hasSkipReason && !opts.isDone;
  return {
    scheduleId: 's1',
    timeSlot,
    isDone: opts.isDone,
    isSkipped,
    sessionState: classifySessionState(timeSlot, opts.isDone, NOW, isSkipped),
  };
}

describe('SkipReason mengubah sessionState jadi "skipped" (Tidak Mengajar)', () => {
  it('sesi lewat tanpa alasan tetap needs_confirmation seperti sebelumnya', () => {
    const status = hitungStatusSesi({ isDone: false, hasSkipReason: false });
    expect(status.sessionState).toBe('needs_confirmation');
    expect(status.isSkipped).toBe(false);
  });

  it('sesi lewat DENGAN alasan tercatat menjadi skipped, bukan needs_confirmation lagi', () => {
    const status = hitungStatusSesi({ isDone: false, hasSkipReason: true });
    expect(status.sessionState).toBe('skipped');
    expect(status.isSkipped).toBe(true);
  });

  it('isDone tetap menang atas alasan yang tercatat — data presensi/jurnal sungguhan lebih valid', () => {
    // Guru sempat mencatat alasan, tapi ternyata TETAP mengisi presensi &
    // jurnal (berubah pikiran) — hasilnya harus "done", bukan "skipped".
    const status = hitungStatusSesi({ isDone: true, hasSkipReason: true });
    expect(status.sessionState).toBe('done');
    expect(status.isSkipped).toBe(false);
  });

  it('classifySessionState tanpa parameter isSkipped tetap berperilaku persis seperti sebelumnya (backward compatible)', () => {
    expect(classifySessionState(SESI_LEWAT_TIMESLOT, false, NOW)).toBe('needs_confirmation');
    expect(classifySessionState(SESI_LEWAT_TIMESLOT, true, NOW)).toBe('done');
  });
});

describe('Sesi Tidak Mengajar tidak dihitung sebagai pekerjaan yang belum selesai', () => {
  it('resolveCurrentWorkflowStep tidak pernah menawarkan sesi yang sudah skipped', () => {
    const skipped = hitungStatusSesi({ isDone: false, hasSkipReason: true });
    expect(resolveCurrentWorkflowStep([skipped], NOW)).toBeNull();
  });

  it('sesi skipped dilewati, yang ditawarkan sesi lain yang masih upcoming', () => {
    const skipped = hitungStatusSesi({ isDone: false, hasSkipReason: true, timeSlot: '07:00-08:00' });
    const nanti = hitungStatusSesi({ isDone: false, hasSkipReason: false, timeSlot: '10:00-11:00' });
    const step = resolveCurrentWorkflowStep([skipped, nanti], NOW);
    expect(step?.status.scheduleId).toBe('s1');
    expect(step?.status.timeSlot).toBe('10:00-11:00');
  });

  it('mirip perhitungan pendingClasses dashboardService: sesi skipped dikeluarkan dari daftar belum lengkap', () => {
    const statuses = [
      hitungStatusSesi({ isDone: false, hasSkipReason: true }),
      hitungStatusSesi({ isDone: false, hasSkipReason: false, timeSlot: '10:00-11:00' }),
      hitungStatusSesi({ isDone: true, hasSkipReason: false, timeSlot: '06:00-07:00' }),
    ];
    // Cermin: countableStatuses = bukan skipped; pending = belum isDone.
    const countable = statuses.filter((s) => !s.isSkipped);
    const pending = countable.filter((s) => !s.isDone);
    expect(countable).toHaveLength(2); // sesi skipped dikeluarkan sepenuhnya dari perhitungan
    expect(pending).toHaveLength(1); // hanya sesi "10:00-11:00" yang masih dianggap belum selesai
  });
});

describe('Alasan tetap tersimpan sebagai histori (bukan sekadar dihapus statusnya)', () => {
  it('skipReason (reason + note) tidak hilang walau sesi sudah dianggap Tidak Mengajar', () => {
    // Meniru bentuk join dashboardService: skipReason dilampirkan apa
    // adanya dari dokumen session_skip_reasons, terlepas dari sessionState.
    const skipDoc = { scheduleId: 's1', reason: 'Rapat', note: 'Rapat dinas kepala sekolah' };
    const status = {
      ...hitungStatusSesi({ isDone: false, hasSkipReason: true }),
      skipReason: { reason: skipDoc.reason, note: skipDoc.note },
    };
    expect(status.sessionState).toBe('skipped');
    expect(status.skipReason).toEqual({ reason: 'Rapat', note: 'Rapat dinas kepala sekolah' });
  });
});
