'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, Clock, Star, FileText } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { SkeletonText } from '../ui/Skeleton';
import * as submissionController from '@/lib/controllers/submissionController';
import * as gradeController from '@/lib/controllers/gradeController';
import { getCached } from '@/lib/utils/sessionCache';
import { SUBMISSION_STATUS } from '@/lib/config/constants';

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

export default function SubmissionPanel({ workspaceId, className, assignment, onBack }: SubmissionPanelProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [gradingStudentId, setGradingStudentId] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState('');
  const [feedbackInput, setFeedbackInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [assignment.id]);

  async function loadData() {
    const alreadyWarm =
      getCached(submissionController.submissionsCacheKey(workspaceId, assignment.id)) !== undefined &&
      getCached(gradeController.gradeDataCacheKey(workspaceId, className)) !== undefined;
    if (!alreadyWarm) {
      setLoading(true);
    }
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
    } finally {
      setLoading(false);
    }
  }

  function openGradeForm(studentId: string) {
    setGradingStudentId(studentId);
    setScoreInput(scores[studentId] || '');
    setFeedbackInput('');
  }

  async function handleSaveGrade(studentId: string) {
    if (!scoreInput.trim()) {
      alert('Nilai wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      await submissionController.gradeSubmission(
        workspaceId,
        className,
        assignment.id,
        assignment.gradeColumnId,
        studentId,
        scoreInput.trim(),
        feedbackInput
      );
      setGradingStudentId(null);
      await loadData();
    } catch (error: any) {
      alert(error.message || 'Gagal menyimpan nilai.');
    } finally {
      setSaving(false);
    }
  }

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
            const isGrading = gradingStudentId === row.studentId;
            return (
              <div key={row.studentId} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-gray-900">{row.studentName}</p>
                    <p className={`flex items-center gap-1.5 text-[11px] font-bold ${status.className}`}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      {status.label}
                      {scores[row.studentId] ? ` • Nilai ${scores[row.studentId]}` : ''}
                    </p>
                  </div>
                  {!isGrading && (
                    <Button variant="secondary" className="w-auto px-4" onClick={() => openGradeForm(row.studentId)}>
                      <Star className="w-3.5 h-3.5" />
                      <span>{row.status === SUBMISSION_STATUS.DINILAI ? 'Ubah Nilai' : 'Beri Nilai'}</span>
                    </Button>
                  )}
                </div>

                {(row.textAnswer || row.fileUrl) && (
                  <div className="p-3 bg-gray-50 rounded-xl space-y-1.5">
                    {row.textAnswer && (
                      <p className="text-[11px] text-gray-700 whitespace-pre-wrap">{row.textAnswer}</p>
                    )}
                    {row.fileUrl && (
                      <a
                        href={row.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:underline"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {row.fileName || 'Lihat lampiran'}
                      </a>
                    )}
                  </div>
                )}

                {isGrading && (
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <input
                      type="text"
                      value={scoreInput}
                      onChange={(e) => setScoreInput(e.target.value)}
                      placeholder="Nilai"
                      className="w-full sm:w-24 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
                    />
                    <input
                      type="text"
                      value={feedbackInput}
                      onChange={(e) => setFeedbackInput(e.target.value)}
                      placeholder="Catatan untuk siswa (opsional)"
                      className="flex-1 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        className="w-auto px-4"
                        onClick={() => setGradingStudentId(null)}
                      >
                        Batal
                      </Button>
                      <Button className="w-auto px-4" loading={saving} onClick={() => handleSaveGrade(row.studentId)}>
                        Simpan
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
