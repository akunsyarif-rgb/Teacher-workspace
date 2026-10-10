import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sisi klien Ulangan Harian dengan adapter palsu (tanpa jaringan/Supabase): memastikan repository hanya memanggil RPC
// bernama, tidak mengirim identitas/skor/waktu dari klien, dan memetakan hasil server.
const rpc = vi.fn();
vi.mock('../lib/adapters/supabaseClient', () => ({ getSupabaseAdapter: () => ({ rpc }) }));

import * as repo from '../lib/repositories/ulanganRepository';
import * as service from '../lib/services/ulanganService';
import * as controller from '../lib/controllers/ulanganController';
import { isUlanganEnabled } from '../lib/config/ulangan';

beforeEach(() => rpc.mockReset());

describe('flag & validasi UX', () => {
  it('modul mati kecuali flag persis "yes"', () => {
    expect(isUlanganEnabled(undefined)).toBe(false);
    expect(isUlanganEnabled('true')).toBe(false);
    expect(isUlanganEnabled('yes')).toBe(true);
  });
  it('menolak paket/ujian tidak valid sebelum ke server', () => {
    const q = { body: 'a', options: ['x', 'y'], correctIndex: 0 };
    expect(service.validatePackageInput({ title: '', subject: '', status: 'draft', questions: [] })).toMatch(/Judul/);
    expect(service.validatePackageInput({ title: 't', subject: '', status: 'final', questions: [] })).toMatch(/minimal/);
    expect(service.validatePackageInput({ title: 't', subject: '', status: 'draft', questions: [{ ...q, correctIndex: 5 }] })).toMatch(/kunci/);
    expect(service.validatePackageInput({ title: 't', subject: '', status: 'final', questions: [q] })).toBeNull();
    const e = { packageId: 'p', title: 't', durationMinutes: 30, opensAt: '2026-01-02T00:00:00Z', closesAt: '2026-01-01T00:00:00Z', classNames: ['7A'], shuffleQuestions: true, shuffleOptions: true, showResult: false };
    expect(service.validateExamInput(e)).toMatch(/setelah/);
    expect(service.validateExamInput({ ...e, closesAt: '2026-01-03T00:00:00Z', classNames: [] })).toMatch(/kelas/i);
    expect(service.validateExamInput({ ...e, closesAt: '2026-01-03T00:00:00Z' })).toBeNull();
  });
});

describe('repository: tidak mengirim identitas/skor/waktu dari klien', () => {
  it('payload save_answer hanya id attempt/soal/opsi + seq', async () => {
    rpc.mockResolvedValue(true);
    await controller.answerQuestion('att', 'q', 'o');
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('ulh_save_answer');
    expect(Object.keys(args).sort()).toEqual(['p_attempt_id', 'p_client_seq', 'p_option_id', 'p_question_id']);
  });
  it('start/submit/save paket/ujian tidak membawa user_id, student_id, workspace_id, skor, status, waktu server', async () => {
    rpc.mockResolvedValue({ id: 'x', exam_id: 'e', title: 't', status: 'active', expires_at: '', server_now: '', remaining_seconds: 5, result: null });
    await repo.startAttempt('e');
    await repo.submitAttempt('a');
    rpc.mockResolvedValue('id');
    await repo.savePackage({ title: 't', subject: '', status: 'final', questions: [{ body: 'b', options: ['1', '2'], correctIndex: 1 }] });
    await repo.saveExam({ packageId: 'p', title: 't', durationMinutes: 5, opensAt: 'a', closesAt: 'b', classNames: ['7A'], shuffleQuestions: true, shuffleOptions: true, showResult: false });
    const forbidden = /user_id|student_id|workspace_id|created_by|score|expires_at|started_at|submitted_at/;
    for (const [, args] of rpc.mock.calls) expect(JSON.stringify(args)).not.toMatch(forbidden);
  });
  it('memetakan hasil server; hasil siswa null bila disembunyikan', async () => {
    rpc.mockResolvedValue({ server_now: 'n', exams: [{ id: 'e', title: 't', subject: 's', status: 'published', duration_minutes: 30, opens_at: 'a', closes_at: 'b',
      attempt: { id: 'a1', status: 'submitted', result: null } }] });
    const r = await repo.listMyExams();
    expect(r.exams[0].attempt).toEqual({ id: 'a1', status: 'submitted', result: null });
    rpc.mockResolvedValue({ attempt: { id: 'a', exam_id: 'e', title: 't', status: 'active', expires_at: 'x', server_now: 'y', remaining_seconds: 90, result: null }, questions: [], answers: { q: 'o' } });
    const v = await repo.getAttempt('a');
    expect(v.attempt.remainingSeconds).toBe(90);
    expect(v.answers).toEqual({ q: 'o' });
  });
});

describe('integritas & autosave sisi klien', () => {
  it('hanya jeda > 3 detik yang dilaporkan', async () => {
    expect(service.shouldReportLeave(3000)).toBe(false);
    expect(service.shouldReportLeave(3001)).toBe(true);
    expect(await controller.reportLeave('a', 'TAB_SWITCH', Date.now(), 2000)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ recorded: true, warning_level: 2 });
    expect(await controller.reportLeave('a', 'TAB_SWITCH', Date.now(), 5000)).toEqual({ recorded: true, warningLevel: 2, reason: undefined });
    expect(rpc.mock.calls[0][1].p_duration_ms).toBe(5000);
  });
  it('peringatan bertingkat berbeda per level', () => {
    const t = [1, 2, 3].map(service.integrityWarningText);
    expect(new Set(t).size).toBe(3);
    expect(t[0]).toMatch(/1/);
  });
  it('client seq selalu naik walau jam mundur/sama', () => {
    const a = service.nextClientSeq(1000);
    const b = service.nextClientSeq(1000);
    const c = service.nextClientSeq(500);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
  it('pesan galat server dipetakan ke bahasa pengguna', () => {
    expect(service.describeUlanganError(new Error('Supabase 400 P0001: attempt_expired'))).toMatch(/habis/);
    expect(service.describeUlanganError(new Error('Supabase 403 42501: exam_not_available'))).toMatch(/tidak tersedia/);
    expect(service.describeUlanganError(new Error('aneh'))).toMatch(/kesalahan/i);
  });
});
