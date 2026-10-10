import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../lib/repositories/ulanganRepository';
import * as service from '../lib/services/ulanganService';
import * as controller from '../lib/controllers/ulanganController';
import { isUlanganEnabled } from '../lib/config/ulangan';
import type { ExamInput } from '../lib/types/ulangan';

// Sisi klien Ulangan Harian dengan fetch palsu (tanpa jaringan): semua lewat /api/ulangan, tanpa identitas/skor/waktu dari klien.
const fetchImpl = vi.fn();
const reply = (data: unknown, status = 200) => fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(status < 400 ? { data } : data), { status }));
const sent = (i = 0) => JSON.parse(fetchImpl.mock.calls[i][1].body);
beforeEach(() => { fetchImpl.mockReset(); repo.__setUlanganDeps({ getToken: async () => 'tok', fetchImpl: fetchImpl as never }); });

const exam = (extra: Partial<ExamInput> = {}): ExamInput => ({
  title: 'UH', subject: 'IPA', durationMinutes: 30, opensAt: '2026-01-01T00:00:00Z', closesAt: '2026-01-02T00:00:00Z', classNames: ['7A'], shuffle: true, showResult: false,
  questions: [{ body: 'Q', options: ['a', 'b'], correctIndex: 1 }], ...extra,
});

describe('flag & validasi UX', () => {
  it('modul mati kecuali flag persis "yes"', () => {
    expect(isUlanganEnabled(undefined)).toBe(false);
    expect(isUlanganEnabled('true')).toBe(false);
    expect(isUlanganEnabled('yes')).toBe(true);
  });
  it('menolak ulangan tidak valid sebelum ke server', () => {
    expect(service.validateExamInput(exam({ title: ' ' }))).toMatch(/Judul/);
    expect(service.validateExamInput(exam({ durationMinutes: 0 }))).toMatch(/Durasi/);
    expect(service.validateExamInput(exam({ closesAt: '2025-01-01T00:00:00Z' }))).toMatch(/setelah/);
    expect(service.validateExamInput(exam({ classNames: [] }))).toMatch(/kelas/i);
    expect(service.validateExamInput(exam({ questions: [] }))).toMatch(/minimal 1 soal/);
    expect(service.validateExamInput(exam({ questions: [{ body: 'Q', options: ['a', 'b'], correctIndex: 5 }] }))).toMatch(/kunci/);
    expect(service.validateExamInput(exam({ questions: [{ body: 'Q', options: ['a', ''], correctIndex: 0 }] }))).toMatch(/kosong/);
    expect(service.validateExamInput(exam())).toBeNull();
  });
});

describe('repository: semua lewat /api/ulangan, tanpa identitas/skor/waktu dari klien', () => {
  it('payload hanya aksi + id/data ulangan; token di header; tidak ada workspace/uid/peran/skor', async () => {
    reply('id1'); await repo.saveExam(exam());
    reply({ ok: true }); await repo.publishExam('e1');
    reply({ id: 'a', exam_id: 'e', title: 't', status: 'active', expires_at: '', server_now: '', remaining_seconds: 5, result: null }); await repo.startAttempt('e1');
    reply(true); await controller.answerQuestion('att', 'q', 'o');
    reply({ id: 'a', exam_id: 'e', title: 't', status: 'submitted', expires_at: '', server_now: '', remaining_seconds: 0, result: null }); await repo.submitAttempt('att');
    const forbidden = /workspace|uid|user_id|student_id|role|admin|score|expires_at|started_at|submitted_at|created_by/i;
    for (let i = 0; i < fetchImpl.mock.calls.length; i++) {
      const [url, init] = fetchImpl.mock.calls[i];
      expect(url).toBe('/api/ulangan');
      expect(init.headers.Authorization).toBe('Bearer tok');
      expect(JSON.stringify(sent(i))).not.toMatch(forbidden);
    }
    expect(sent(0)).toMatchObject({ action: 'exam.save', exam: { title: 'UH', duration_minutes: 30, class_names: ['7A'], questions: [{ correct_index: 1 }] } });
    expect(sent(3)).toMatchObject({ action: 'attempt.answer', attemptId: 'att', questionId: 'q', optionId: 'o' });
    expect(Object.keys(sent(3)).sort()).toEqual(['action', 'attemptId', 'optionId', 'questionId', 'seq']);
  });
  it('memetakan respons server; hasil siswa null bila disembunyikan', async () => {
    reply({ server_now: 'n', exams: [{ id: 'e', title: 't', subject: 's', status: 'published', duration_minutes: 30, opens_at: 'a', closes_at: 'b', attempt: { id: 'a1', status: 'submitted', result: null } }] });
    const r = await repo.listMyExams();
    expect(r.exams[0].attempt).toEqual({ id: 'a1', status: 'submitted', result: null });
    reply({ attempt: { id: 'a', exam_id: 'e', title: 't', status: 'active', expires_at: 'x', server_now: 'y', remaining_seconds: 90, result: null }, questions: [], answers: { q: 'o' } });
    const v = await repo.getAttempt('a');
    expect(v.attempt.remainingSeconds).toBe(90);
    expect(v.answers).toEqual({ q: 'o' });
    reply({ exam: { id: 'e', title: 'T', status: 'closed', opens_at: 'a', closes_at: 'b', duration_minutes: 30, server_now: 'n' }, summary: { assigned: 2, started: 1, submitted: 1, avg_score: 50, min_score: 50, max_score: 50 },
      rows: [{ student_id: 's1', name: 'Budi', class_name: '7A', attempt_id: 'a', status: 'submitted', answered_count: 2, total_questions: 2, score: 50, max_score: 2, correct_count: 1, leave_count: 1, max_warning_level: 1, last_event_at: null }] });
    const m = await repo.getExamResults('e');
    expect(m.summary).toMatchObject({ assigned: 2, avgScore: 50 });
    expect(m.rows[0]).toMatchObject({ studentId: 's1', name: 'Budi', score: 50, leaveCount: 1 });
  });
  it('galat server → UlanganApiError berisi kode; jaringan putus → network; tanpa token → not_logged_in; dipetakan ke bahasa pengguna', async () => {
    reply({ error: 'exam_locked' }, 409);
    const e1 = await repo.publishExam('x').catch((e) => e);
    expect(e1).toBeInstanceOf(repo.UlanganApiError);
    expect(e1).toMatchObject({ code: 'exam_locked', status: 409 });
    expect(controller.describeError(e1)).toMatch(/tidak bisa diubah/);
    fetchImpl.mockRejectedValueOnce(new TypeError('failed'));
    expect(controller.describeError(await repo.listExams().catch((e) => e))).toMatch(/Koneksi/);
    repo.__setUlanganDeps({ getToken: async () => null, fetchImpl: fetchImpl as never });
    expect(await repo.listExams().catch((e) => e)).toMatchObject({ code: 'not_logged_in', status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [code, re] of [['attempt_expired', /habis/], ['not_a_teacher', /berwenang/], ['not_a_student', /berwenang/], ['exam_not_open', /belum dibuka/], ['class_not_found', /Kelas/], ['exam_not_available', /tidak tersedia/], ['mystery', /kesalahan/i]] as const)
      expect(controller.describeError(new repo.UlanganApiError(code, 400)), code).toMatch(re);
  });
});

describe('integritas & autosave sisi klien', () => {
  it('hanya jeda > 3 detik yang dilaporkan', async () => {
    expect(service.shouldReportLeave(3000)).toBe(false);
    expect(service.shouldReportLeave(3001)).toBe(true);
    expect(await controller.reportLeave('a', 'TAB_SWITCH', Date.now(), 2000)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    reply({ recorded: true, warning_level: 2 });
    expect(await controller.reportLeave('a', 'TAB_SWITCH', Date.now(), 5000)).toEqual({ recorded: true, warningLevel: 2, reason: undefined });
    expect(sent()).toMatchObject({ action: 'attempt.event', eventType: 'TAB_SWITCH', durationMs: 5000 });
  });
  it('peringatan bertingkat berbeda per level; client seq selalu naik', () => {
    expect(new Set([1, 2, 3].map(service.integrityWarningText)).size).toBe(3);
    const a = service.nextClientSeq(1000); const b = service.nextClientSeq(1000); const c = service.nextClientSeq(500);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});
