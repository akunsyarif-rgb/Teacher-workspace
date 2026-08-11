'use client';

import React, { useState, useEffect, useMemo, MutableRefObject } from 'react';
import { CheckCircle2, CloudOff, Table, Plus, Save, Circle, Lock } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import GradesTable, { cellKey } from './GradesTable';
import GradesReviewModal, { GradeChange } from './GradesReviewModal';
import GradeColumnModal from './GradeColumnModal';
import ConfirmDeleteModal from '@/src/components/ui/ConfirmDeleteModal';
import Modal from '@/src/components/ui/Modal';
import InlineAlert from '@/src/components/ui/InlineAlert';
import * as gradeController from '@/lib/controllers/gradeController';
import * as studentController from '@/lib/controllers/classController';
import { getCached } from '@/lib/utils/sessionCache';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import { useOnlineStatus } from '@/src/hooks/useOnlineStatus';
import { SkeletonTable, SkeletonText } from '../ui/Skeleton';

type GradesTabProps = {
  className: string;
  // Dipakai AttendanceForm untuk exit guard "Unsaved Changes" & ringkasan
  // "Selesai Mengajar" — jumlah sel yang berubah tapi belum direview&simpan.
  onDraftChange?: (count: number) => void;
  // AttendanceForm memicu ini dari dialog Unsaved Changes / Selesai
  // Mengajar untuk membuka modal Review — BUKAN langsung menyimpan nilai,
  // supaya "Proteksi Tinggi" (guru harus lihat & konfirmasi dulu) tetap
  // berlaku walau lewat jalur keluar-kelas, bukan cuma tombol Review biasa.
  openReviewRef?: MutableRefObject<(() => void) | null>;
  // Dipanggil setelah nilai BENAR-BENAR tersimpan (guru menekan konfirmasi
  // di GradesReviewModal) — AttendanceForm memakainya untuk melanjutkan
  // navigasi yang tertunda dari dialog Unsaved Changes ("Simpan & Keluar"),
  // supaya labelnya jujur: benar-benar keluar setelah tersimpan, bukan
  // berhenti di layar Review begitu saja.
  onSavedSuccessfully?: () => void;
};

export default function GradesTab({ className, onDraftChange, openReviewRef, onSavedSuccessfully }: GradesTabProps) {
  const { workspaceId } = useWorkspace();
  const isOnline = useOnlineStatus();
  const [columns, setColumns] = useState<any[]>([]);
  // `grades` = nilai yang sedang ditampilkan/bisa diketik (draft lokal
  // untuk sel yang belum/sedang diedit). `savedGrades` = salinan terakhir
  // yang benar-benar tersimpan di Firestore — dipakai sebagai acuan status
  // tiap sel (Belum diisi/Draft/Tersimpan) DAN sebagai isi modal Review.
  // Proteksi Tinggi: keduanya HANYA disamakan lagi setelah guru menekan
  // konfirmasi di GradesReviewModal — tidak pernah oleh onChange/onBlur.
  const [grades, setGrades] = useState<Record<string, Record<string, string>>>({});
  const [savedGrades, setSavedGrades] = useState<Record<string, Record<string, string>>>({});
  const [unlockedCells, setUnlockedCells] = useState<Set<string>>(new Set());
  const [students, setStudents] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingData, setLoadingData] = useState(true);
  const [deleteColumnTarget, setDeleteColumnTarget] = useState<{ id: string; title: string } | null>(null);
  // Sel terkunci yang pensilnya baru ditekan, menunggu jawaban "Ubah nilai?".
  // Tanpa gerbang ini satu sentuhan tak sengaja di layar sentuh langsung
  // membuka nilai yang sudah terkunci untuk diketik ulang.
  const [unlockTarget, setUnlockTarget] = useState<{
    studentId: string;
    columnId: string;
    studentName: string;
    columnTitle: string;
    currentValue: string;
  } | null>(null);

  useEffect(() => {
    if (className && workspaceId) {
      loadAllData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [className, workspaceId]);

  async function loadAllData() {
    const alreadyWarm =
      !!workspaceId &&
      getCached(gradeController.gradeDataCacheKey(workspaceId, className)) !== undefined &&
      getCached(studentController.studentsInClassCacheKey(workspaceId, className)) !== undefined;

    if (!alreadyWarm) {
      setLoadingData(true);
    }
    await Promise.all([loadData(), loadStudents()]);
    setLoadingData(false);
  }

  async function loadData() {
    if (!className || !workspaceId) return;
    try {
      const data = await gradeController.fetchGradeData(workspaceId, className);
      setColumns(data.columns);
      setGrades(data.grades);
      setSavedGrades(data.grades);
      setUnlockedCells(new Set());
    } catch (error) {
      console.error('Gagal memuat data nilai:', error);
    }
  }

  async function loadStudents() {
    if (!workspaceId || !className) return;
    try {
      const list = await studentController.fetchStudentsInClass(workspaceId, className);
      setStudents(list);
    } catch (error) {
      console.error('Gagal memuat siswa:', error);
    }
  }

  function handleScoreChange(studentId: string, columnId: string, value: string) {
    setGrades((prev) => ({
      ...prev,
      [studentId]: { ...(prev[studentId] || {}), [columnId]: value },
    }));
  }

  function handleRequestUnlock(studentId: string, columnId: string) {
    const student = students.find((s) => s.id === studentId);
    const column = columns.find((c) => c.id === columnId);
    setUnlockTarget({
      studentId,
      columnId,
      studentName: student?.name ?? '',
      columnTitle: column?.title ?? '',
      currentValue: savedGrades[studentId]?.[columnId] ?? '',
    });
  }

  function confirmUnlock() {
    if (!unlockTarget) return;
    setUnlockedCells((prev) => new Set(prev).add(cellKey(unlockTarget.studentId, unlockTarget.columnId)));
    setUnlockTarget(null);
  }

  // Sel dianggap "berubah & siap direview" kalau nilainya beda dari
  // savedGrades — mencakup baik sel kosong yang baru diisi maupun sel
  // terkunci yang sudah dibuka lewat Edit lalu diubah.
  const pendingChanges: GradeChange[] = useMemo(() => {
    const changes: GradeChange[] = [];
    students.forEach((student) => {
      columns.forEach((col) => {
        const savedValue = savedGrades[student.id]?.[col.id] ?? '';
        const currentValue = grades[student.id]?.[col.id] ?? '';
        if (currentValue !== savedValue) {
          changes.push({
            studentName: student.name,
            columnTitle: col.title,
            oldValue: savedValue,
            newValue: currentValue,
          });
        }
      });
    });
    return changes;
  }, [students, columns, grades, savedGrades]);

  useEffect(() => {
    onDraftChange?.(pendingChanges.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChanges.length]);

  useEffect(() => {
    if (!openReviewRef) return;
    openReviewRef.current = () => setReviewOpen(true);
    return () => {
      if (openReviewRef.current) openReviewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReviewRef]);

  useEffect(() => {
    return () => {
      onDraftChange?.(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirmSave() {
    if (!workspaceId) return;
    setErrorMsg('');
    try {
      await gradeController.saveGrades(workspaceId, className, grades);
      setSavedGrades(grades);
      setUnlockedCells(new Set());
      setSuccess(true);
      setReviewOpen(false);
      onSavedSuccessfully?.();
    } catch (error: any) {
      setErrorMsg(error.message || 'Gagal menyimpan nilai.');
      throw error;
    }
  }

  async function handleAddColumn(title: string, type: string) {
    if (!workspaceId) return;
    await gradeController.addColumn(workspaceId, className, title, type);
    await loadData();
  }

  function handleDeleteColumn(columnId: string) {
    const col = columns.find((c) => c.id === columnId);
    setDeleteColumnTarget({ id: columnId, title: col?.title || 'Kolom ini' });
  }

  async function confirmDeleteColumn() {
    if (!deleteColumnTarget) return;
    await gradeController.removeColumn(deleteColumnTarget.id);
    await loadData();
    setDeleteColumnTarget(null);
  }

  return (
    <div className="space-y-6">
      <Card className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Table className="w-4 h-4 text-blue-600" />
            Matriks Daftar Nilai Kelas {className}
          </h3>
          <p className="text-xs text-gray-500">Kelola komponen nilai tugas, ulangan, dan rekap rata-rata</p>
          <div className="flex items-center gap-3 pt-2 text-[10px] font-bold text-gray-400">
            <span className="flex items-center gap-1">
              <Circle className="w-3 h-3" /> Belum diisi
            </span>
            <span className="flex items-center gap-1 text-amber-600">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Draft
            </span>
            <span className="flex items-center gap-1 text-emerald-600">
              <Lock className="w-3 h-3" /> Tersimpan
            </span>
          </div>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <Button variant="secondary" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            <span>Tambah Kolom</span>
          </Button>
          <Button onClick={() => setReviewOpen(true)} disabled={pendingChanges.length === 0}>
            <Save className="w-4 h-4" />
            <span>
              {pendingChanges.length > 0 ? `Review & Simpan (${pendingChanges.length})` : 'Tidak Ada Perubahan'}
            </span>
          </Button>
        </div>
      </Card>

      <InlineAlert message={errorMsg} onDismiss={() => setErrorMsg('')} />

      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          {isOnline ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Nilai berhasil disimpan &amp; terkunci — tekan ikon pensil di sel untuk mengoreksi.</span>
            </>
          ) : (
            <>
              <CloudOff className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Nilai tersimpan offline — akan tersinkron otomatis saat koneksi kembali.</span>
            </>
          )}
        </div>
      )}

      <GradeColumnModal isOpen={showModal} onClose={() => setShowModal(false)} onSubmit={handleAddColumn} />

      <GradesReviewModal
        isOpen={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onConfirm={handleConfirmSave}
        changes={pendingChanges}
      />

      <Modal isOpen={!!unlockTarget} onClose={() => setUnlockTarget(null)} title="Ubah nilai?">
        <div className="space-y-4">
          <p className="text-xs text-gray-600">
            Nilai ini sudah terkunci. Kalau dilanjutkan, selnya dibuka untuk diketik ulang — nilai baru
            tetap harus melewati Review sebelum tersimpan.
          </p>
          <div className="p-3 bg-gray-50 border border-gray-100 rounded-2xl space-y-0.5">
            <p className="text-xs font-bold text-gray-900">{unlockTarget?.studentName}</p>
            <p className="text-[11px] text-gray-500">
              {unlockTarget?.columnTitle} — nilai sekarang{' '}
              <span className="font-bold text-emerald-700">{unlockTarget?.currentValue}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setUnlockTarget(null)} className="flex-1">
              Batal
            </Button>
            <Button onClick={confirmUnlock} className="flex-1">
              Lanjutkan
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDeleteModal
        isOpen={!!deleteColumnTarget}
        onClose={() => setDeleteColumnTarget(null)}
        onConfirm={confirmDeleteColumn}
        title="Hapus Kolom Nilai?"
        itemName={deleteColumnTarget?.title || ''}
        itemDetail={`Seluruh nilai siswa di kolom ini akan ikut terhapus — Kelas ${className}`}
        requireTyping={false}
        type="warning"
      />

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        {loadingData ? (
          <div className="p-6">
            <SkeletonTable rows={4} cols={5} />
          </div>
        ) : (
          <GradesTable
            students={students}
            columns={columns}
            grades={grades}
            savedGrades={savedGrades}
            unlockedCells={unlockedCells}
            onScoreChange={handleScoreChange}
            onRequestUnlock={handleRequestUnlock}
            onDeleteColumn={handleDeleteColumn}
          />
        )}
      </div>
    </div>
  );
}
