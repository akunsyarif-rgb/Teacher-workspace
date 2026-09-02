'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Star,
  FileText,
  Eye,
  Lock,
  Pencil,
  MessageSquare,
  Link2,
  Download,
  ClipboardPaste,
  RefreshCw,
} from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import InlineAlert from '../ui/InlineAlert';
import { SkeletonText } from '../ui/Skeleton';
import * as submissionController from '@/lib/controllers/submissionController';
import * as gradeController from '@/lib/controllers/gradeController';
import { getCached, clearAllCached } from '@/lib/utils/sessionCache';
import { downloadCsv } from '@/lib/utils/csvExport';
import { SUBMISSION_STATUS } from '@/lib/config/constants';

const SUBMISSION_CSV_COLUMNS = [
  { key: 'studentName', label: 'Nama Siswa' },
  { key: 'studentNis', label: 'NIS' },
  { key: 'status', label: 'Status' },
  { key: 'textAnswer', label: 'Jawaban' },
  { key: 'attachmentLinks', label: 'Link Lampiran' },
  { key: 'score', label: 'Nilai' },
  { key: 'feedback', label: 'Catatan Guru' },
  { key: 'pastedFlag', label: 'Indikasi Tempel' },
];

const STATUS_LABEL: Record<string, { label: string; className: string; icon: any }> = {
  [SUBMISSION_STATUS.BELUM_MENGUMPULKAN]: { label: 'Belum mengumpulkan', className: 'text-gray-400', icon: Circle },
  [SUBMISSION_STATUS.MENUNGGU_PENILAIAN]: { label: 'Menunggu penilaian', className: 'text-amber-600', icon: Clock },
  [SUBMISSION_STATUS.DINILAI]: { label: 'Dinilai', className: 'text-emerald-600', icon: CheckCircle2 },
};

type SubmissionPanelProps = {
  workspaceId: string;
  className: string;
  assignment: {
    id: string;
    title: string;
    dueDate: string;
    description?: string;
    gradeColumnId: string;
    materialFileUrl?: string;
    materialFileName?: string;
  };
  onBack: () => void;
};

function attachmentsOf(row: any) {
  if (row?.attachments && row.attachments.length > 0) return row.attachments;
  if (row?.fileUrl) return [{ fileUrl: row.fileUrl, fileName: row.fileName }];
  return [];
}

function formatSubmittedAt(iso?: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export default function SubmissionPanel({ workspaceId, className, assignment, onBack }: SubmissionPanelProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // Beda dari `loading`: dipakai tombol "Segarkan" supaya daftar yang
  // sudah tampil TIDAK ikut hilang diganti skeleton saat guru cuma minta
  // data terbaru (mis. cek siapa yang baru saja mengumpulkan) — sebelumnya
  // satu-satunya cara melihat pengumpulan baru adalah pindah menu lalu
  // kembali lagi ke tugas ini.
  const [refreshing, setRefreshing] = useState(false);
  // ID siswa yang submission-nya sedang DIBUKA untuk direview. Menilai
  // hanya mungkin dari dalam sini — daftar di luar tidak lagi punya tombol
  // "Beri Nilai" langsung, supaya guru selalu melihat isi pekerjaannya
  // dulu sebelum menaruh angka.
  const [reviewingStudentId, setReviewingStudentId] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState('');
  const [feedbackInput, setFeedbackInput] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackSavedFor, setFeedbackSavedFor] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // Nilai yang sudah tersimpan itu TERKUNCI, sama seperti di matriks nilai:
  // kolomnya baru bisa diketik ulang setelah guru menjawab "Ubah Nilai?".
  const [unlocked, setUnlocked] = useState(false);
  const [unlockAsked, setUnlockAsked] = useState(false);
  // Konfirmasi terakhir sebelum nilai benar-benar tertulis & terkunci.
  const [confirmGrade, setConfirmGrade] = useState(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.id]);

  async function loadData(options?: { forceRefresh?: boolean }) {
    if (options?.forceRefresh) {
      // Cache sessionCache (TTL 60 dtk) bisa saja belum kedaluwarsa tepat
      // saat guru menekan Segarkan — dibersihkan paksa di sini supaya
      // tombolnya selalu benar-benar mengambil data terbaru, bukan
      // kadang-kadang menampilkan hasil lama yang masih "hangat".
      clearAllCached();
      setRefreshing(true);
    } else {
      const alreadyWarm =
        getCached(submissionController.submissionsCacheKey(workspaceId, assignment.id)) !== undefined &&
        getCached(gradeController.gradeDataCacheKey(workspaceId, className)) !== undefined;
      if (!alreadyWarm) {
        setLoading(true);
      }
    }
    setErrorMsg('');
    try {
      const [submissions, gradeData] = await Promise.all([
        submissionController.fetchSubmissions(workspaceId, className, assignment.id),
        gradeController.fetchGradeData(workspaceId, className),
      ]);
      setRows(submissions);
      const scoreMap: Record<string, string> = {};
      Object.keys(gradeData.grades).forEach((studentId) => {
        const score = gradeData.grades[studentId][assignment.gradeColumnId];
        if (score) scoreMap[studentId] = score;
      });
      setScores(scoreMap);
    } catch (error) {
      console.error('Gagal memuat submission:', error);
      setErrorMsg('Gagal memuat pengumpulan siswa. Periksa koneksi internet lalu buka lagi tugas ini.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleRefresh() {
    loadData({ forceRefresh: true });
  }

  function openReview(studentId: string) {
    const row = rows.find((r) => r.studentId === studentId);
    setReviewingStudentId(studentId);
    setScoreInput(scores[studentId] || '');
    setFeedbackInput(row?.feedback || '');
    setFeedbackSavedFor(null);
    setErrorMsg('');
    // Sel dianggap terkunci kalau nilainya SUDAH tersimpan; kalau belum,
    // langsung bisa diketik tanpa dialog apa pun.
    setUnlocked(!scores[studentId]);
    setUnlockAsked(false);
  }

  function closeReview() {
    setReviewingStudentId(null);
    setUnlocked(false);
    setUnlockAsked(false);
    setConfirmGrade(false);
  }

  // Unduh CSV semua siswa di tugas ini sekaligus — supaya guru tidak perlu
  // buka Review satu per satu hanya untuk membaca/merekap jawaban.
  function handleDownloadCsv() {
    const csvRows = rows.map((row) => {
      const linkParts = attachmentsOf(row)
        .map((att: any) => att.fileUrl)
        .filter(Boolean);
      if (row?.externalLink?.url) linkParts.push(row.externalLink.url);

      return {
        studentName: row.studentName || '-',
        studentNis: row.studentNis || '-',
        status: (STATUS_LABEL[row.status] || STATUS_LABEL[SUBMISSION_STATUS.BELUM_MENGUMPULKAN]).label,
        textAnswer: row.textAnswer || '-',
        attachmentLinks: linkParts.length > 0 ? linkParts.join(' | ') : '-',
        score: scores[row.studentId] || '-',
        feedback: row.feedback || '-',
        // Sinyal "pernah ditempel", BUKAN bukti kecurangan — lihat komentar
        // di handlePasteAnswer (app/student/tugas/page.tsx). Kolom ini
        // supaya guru bisa urutkan/filter di Excel, bukan buka satu-satu.
        pastedFlag: row.answerPastedFlag ? 'Ya' : '-',
      };
    });

    const safeTitle = (assignment.title || 'Tugas').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    downloadCsv(`Jawaban_${safeTitle || 'Tugas'}_${className}.csv`, csvRows, SUBMISSION_CSV_COLUMNS);
  }

  async function handleSaveFeedback(studentId: string) {
    setErrorMsg('');
    setSavingFeedback(true);
    try {
      // Catatan disimpan lewat jalurnya sendiri — guru boleh memberi
      // masukan tanpa harus sekaligus menentukan nilainya.
      await submissionController.saveFeedback(
        workspaceId,
        className,
        assignment.id,
        studentId,
        feedbackInput
      );
      setFeedbackSavedFor(studentId);
      await loadData();
    } catch (error: any) {
      setErrorMsg(error.message || 'Gagal menyimpan catatan.');
    } finally {
      setSavingFeedback(false);
    }
  }

  async function handleConfirmGrade(studentId: string) {
    setErrorMsg('');
    setSavingGrade(true);
    try {
      const row = rows.find((r) => r.studentId === studentId);
      await submissionController.gradeSubmission(
        workspaceId,
        className,
        assignment.id,
        assignment.gradeColumnId,
        studentId,
        scoreInput.trim(),
        feedbackInput,
        // Menilai siswa yang belum mengumpulkan TIDAK boleh menandai
        // pengumpulannya selesai — itu yang dulu mengunci siswa.
        !!row?.hasSubmitted
      );
      setConfirmGrade(false);
      closeReview();
      await loadData();
    } catch (error: any) {
      setErrorMsg(error.message || 'Gagal menyimpan nilai.');
    } finally {
      setSavingGrade(false);
    }
  }

  const reviewingRow = rows.find((r) => r.studentId === reviewingStudentId) || null;
  const existingScore = reviewingStudentId ? scores[reviewingStudentId] || '' : '';

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" />
        Kembali ke Daftar Tugas
      </button>

      <Card className="space-y-1">
        <h3 className="text-sm font-bold text-gray-900">{assignment.title}</h3>
        {assignment.description && <p className="text-xs text-gray-500">{assignment.description}</p>}
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          Tenggat {assignment.dueDate}
        </p>
        {assignment.materialFileUrl && (
          <a
            href={assignment.materialFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:underline pt-1"
          >
            <FileText className="w-3.5 h-3.5" />
            {assignment.materialFileName || 'Lihat materi soal'}
          </a>
        )}
      </Card>

      <InlineAlert message={errorMsg} onDismiss={() => setErrorMsg('')} />

      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-[11px] font-bold text-gray-500">
            {rows.filter((r) => r.status !== SUBMISSION_STATUS.BELUM_MENGUMPULKAN).length} dari {rows.length} siswa
            sudah mengumpulkan
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Muat ulang untuk melihat pengumpulan terbaru"
              className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 hover:text-gray-900 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Menyegarkan...' : 'Segarkan'}
            </button>
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:underline"
            >
              <Download className="w-3.5 h-3.5" />
              Unduh Jawaban (CSV)
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-6">
            <SkeletonText lines={4} />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-xs text-gray-400">Belum ada siswa di kelas ini.</p>
        ) : (
          rows.map((row) => {
            const status = STATUS_LABEL[row.status] || STATUS_LABEL[SUBMISSION_STATUS.BELUM_MENGUMPULKAN];
            const StatusIcon = status.icon;
            const isReviewing = reviewingStudentId === row.studentId;
            const attachments = attachmentsOf(row);
            const externalLink = row?.externalLink?.url ? row.externalLink : null;
            const submittedAtLabel = formatSubmittedAt(row.submittedAt);
            const hasContent = !!row.textAnswer || attachments.length > 0 || !!externalLink;

            return (
              <div key={row.studentId} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate">{row.studentName}</p>
                    <p className={`flex items-center gap-1.5 text-[11px] font-bold ${status.className}`}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      {status.label}
                      {submittedAtLabel && row.status !== SUBMISSION_STATUS.BELUM_MENGUMPULKAN && (
                        <span className="font-medium text-gray-400">• {submittedAtLabel}</span>
                      )}
                      {scores[row.studentId] ? (
                        <span className="text-emerald-600">• Nilai {scores[row.studentId]}</span>
                      ) : (
                        ''
                      )}
                      {row.answerPastedFlag && (
                        <span
                          title="Jawaban ditempel dari clipboard — bukan bukti, periksa isinya sebelum menilai"
                          className="inline-flex text-amber-500"
                        >
                          <ClipboardPaste className="w-3 h-3" />
                        </span>
                      )}
                    </p>
                  </div>
                  {!isReviewing && (
                    <Button variant="secondary" className="w-auto px-4" onClick={() => openReview(row.studentId)}>
                      <Eye className="w-3.5 h-3.5" />
                      <span>Review</span>
                    </Button>
                  )}
                </div>

                {isReviewing && (
                  <div className="space-y-3 pt-1">
                    {/* LANGKAH 1 — lihat dulu apa yang dikumpulkan. Ini
                        sengaja berada di atas kolom nilai: nilai tidak
                        boleh diisi sebelum isinya terlihat. */}
                    <div className="p-3 bg-gray-50 rounded-xl space-y-2">
                      <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                        Jawaban siswa
                      </p>
                      {!hasContent ? (
                        <p className="text-[11px] text-gray-400">
                          Siswa ini belum mengumpulkan apa pun. Nilai tetap bisa diisi (mis. pekerjaan luring), tapi
                          statusnya tetap &quot;Belum mengumpulkan&quot; supaya siswa masih bisa mengirim.
                        </p>
                      ) : (
                        <>
                          {row.textAnswer && (
                            <>
                              {row.answerPastedFlag && (
                                <p className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 rounded-lg px-2 py-1 w-fit">
                                  <ClipboardPaste className="w-3 h-3 shrink-0" />
                                  Jawaban ini ditempel dari clipboard — bukan bukti kecurangan, tapi layak diperiksa
                                  lebih teliti
                                </p>
                              )}
                              <p className="text-[11px] text-gray-700 whitespace-pre-wrap">{row.textAnswer}</p>
                            </>
                          )}
                          {attachments.map((att: any, idx: number) => (
                            <a
                              key={`${att.fileUrl}-${idx}`}
                              href={att.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:underline"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              {att.fileName || `Buka lampiran ${idx + 1}`}
                            </a>
                          ))}
                          {externalLink && (
                            // Link eksternal (siswa tempel sendiri, biasanya
                            // karena upload foto gagal) — sengaja dibuka apa
                            // adanya sebagai tautan biasa, TIDAK pernah lewat
                            // fetch/proxy server: aplikasi tidak pernah
                            // mengklaim sudah memverifikasi isi/aksesnya.
                            <a
                              href={externalLink.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:underline"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              {externalLink.label || 'Buka Google Drive'}
                            </a>
                          )}
                        </>
                      )}
                    </div>

                    {/* LANGKAH 2 — catatan, berdiri sendiri: boleh disimpan
                        tanpa mengisi nilai sama sekali. */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                        Catatan untuk siswa
                      </label>
                      <textarea
                        value={feedbackInput}
                        onChange={(e) => setFeedbackInput(e.target.value)}
                        rows={2}
                        placeholder="Masukan untuk siswa (opsional)"
                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          className="w-auto px-4"
                          loading={savingFeedback}
                          onClick={() => handleSaveFeedback(row.studentId)}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Simpan Catatan</span>
                        </Button>
                        {feedbackSavedFor === row.studentId && (
                          <span className="text-[11px] font-bold text-emerald-600">Catatan tersimpan</span>
                        )}
                      </div>
                    </div>

                    {/* LANGKAH 3 — nilai, lewat kunci & konfirmasi yang sama
                        dengan matriks nilai. */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
                        Nilai
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        {existingScore && !unlocked ? (
                          <button
                            type="button"
                            onClick={() => setUnlockAsked(true)}
                            className="w-full sm:w-40 flex items-center justify-between gap-2 p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-xs font-bold text-emerald-700"
                          >
                            <span className="flex items-center gap-1.5">
                              <Lock className="w-3.5 h-3.5" />
                              {existingScore}
                            </span>
                            <Pencil className="w-3.5 h-3.5 text-emerald-500" />
                          </button>
                        ) : (
                          <input
                            type="text"
                            inputMode="numeric"
                            value={scoreInput}
                            onChange={(e) => setScoreInput(e.target.value)}
                            placeholder="Nilai"
                            className="w-full sm:w-40 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
                          />
                        )}
                        <div className="flex gap-2 sm:ml-auto">
                          <Button variant="secondary" className="w-auto px-4" onClick={closeReview}>
                            Tutup
                          </Button>
                          <Button
                            className="w-auto px-4"
                            disabled={(!!existingScore && !unlocked) || !scoreInput.trim()}
                            onClick={() => setConfirmGrade(true)}
                          >
                            <Star className="w-3.5 h-3.5" />
                            <span>{existingScore ? 'Ubah Nilai' : 'Simpan Nilai'}</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {!isReviewing && row.feedback && (
                  <div className="p-3 bg-blue-50 rounded-xl">
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-0.5">
                      Catatan untuk siswa
                    </p>
                    <p className="text-[11px] text-blue-800 whitespace-pre-wrap">{row.feedback}</p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Gerbang yang sama persis dengan matriks nilai — satu sentuhan tak
          sengaja tidak boleh langsung membuka nilai terkunci untuk diketik
          ulang. */}
      <Modal isOpen={unlockAsked} onClose={() => setUnlockAsked(false)} title="Ubah nilai?">
        <div className="space-y-4">
          <p className="text-xs text-gray-600">
            Nilai ini sudah terkunci. Kalau dilanjutkan, kolomnya dibuka untuk diketik ulang — nilai baru tetap harus
            dikonfirmasi sebelum tersimpan.
          </p>
          <div className="p-3 bg-gray-50 border border-gray-100 rounded-2xl space-y-0.5">
            <p className="text-xs font-bold text-gray-900">{reviewingRow?.studentName}</p>
            <p className="text-[11px] text-gray-500">
              {assignment.title} — nilai sekarang{' '}
              <span className="font-bold text-emerald-700">{existingScore}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setUnlockAsked(false)} className="flex-1">
              Batal
            </Button>
            <Button
              onClick={() => {
                setUnlocked(true);
                setUnlockAsked(false);
              }}
              className="flex-1"
            >
              Lanjutkan
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={confirmGrade}
        onClose={() => setConfirmGrade(false)}
        title={existingScore ? 'Ubah Nilai?' : 'Simpan Nilai?'}
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            {existingScore
              ? 'Nilai yang sudah terkunci 🔒 akan diubah. Periksa sekali lagi sebelum konfirmasi.'
              : 'Nilai akan disimpan dan terkunci 🔒. Periksa sekali lagi sebelum konfirmasi — nilai terkunci tetap bisa dikoreksi lewat ikon pensil.'}
          </p>
          <div className="p-3 bg-gray-50 border border-gray-100 rounded-2xl space-y-0.5">
            <p className="text-xs font-bold text-gray-900">{reviewingRow?.studentName}</p>
            <p className="text-[11px] text-gray-500">
              {assignment.title}
              {existingScore ? ` — ${existingScore} → ` : ' — nilai '}
              <span className="font-bold text-blue-600">{scoreInput.trim() || '-'}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmGrade(false)} className="flex-1">
              Batal
            </Button>
            <Button
              className="flex-1"
              loading={savingGrade}
              onClick={() => reviewingStudentId && handleConfirmGrade(reviewingStudentId)}
            >
              <Lock className="w-4 h-4" />
              <span>{savingGrade ? 'Menyimpan...' : existingScore ? 'Ubah Nilai' : 'Simpan Nilai'}</span>
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
