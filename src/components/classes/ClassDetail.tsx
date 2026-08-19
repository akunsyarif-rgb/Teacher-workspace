'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, Copy, Check, Plus, Settings } from 'lucide-react';
import { auth } from '@/src/config/firebase';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as classController from '@/lib/controllers/classController';
import { getCached } from '@/lib/utils/sessionCache';
import ConfirmDeleteModal from '@/src/components/ui/ConfirmDeleteModal';
import Modal from '@/src/components/ui/Modal';
import Input from '@/src/components/ui/Input';
import Button from '@/src/components/ui/Button';
import AddStudentForm from './AddStudentForm';
import BulkImportForm from './BulkImportForm';
import { CLASS_NAME_MAX_LENGTH, normalizeClassName, validateClassName } from '@/lib/utils/classNameValidation';
import { buildStudentCodesShareText } from '@/lib/utils/studentCodesShare';

type ClassDetailProps = {
  className: string;
  onBack: () => void;
  backLabel?: string;
  // Dipanggil setelah rename berhasil supaya parent (ClassManagement)
  // memindahkan "kelas aktif" yang sedang dibuka ke nama baru — tanpa ini,
  // effect [workspaceId, className] di bawah akan tetap query nama lama
  // yang sudah tidak ada lagi datanya.
  onRenamed?: (newName: string) => void;
};

export default function ClassDetail({
  className,
  onBack,
  backLabel = 'Kembali ke Daftar Kelas',
  onRenamed,
}: ClassDetailProps) {
  const { workspaceId } = useWorkspace();
  const [students, setStudents] = useState<any[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; nis: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [confirmDeleteClass, setConfirmDeleteClass] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [renameValue, setRenameValue] = useState(className);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');

  useEffect(() => {
    if (workspaceId && className) {
      loadStudents();
    }
  }, [workspaceId, className]);

  async function loadStudents() {
    if (!workspaceId || !className) return;
    // Data kelas ini mungkin sudah hangat di sessionCache (mis. guru barusan
    // dari tab lain di kelas yang sama) — kalau iya, jangan nyalakan
    // spinner: cukup refresh diam-diam di belakang layar.
    const alreadyWarm = getCached(classController.studentsInClassCacheKey(workspaceId, className)) !== undefined;
    if (!alreadyWarm) {
      setLoading(true);
    }
    try {
      const list = await classController.fetchStudentsInClass(workspaceId, className);
      setStudents(list);
    } catch (error) {
      console.error('Gagal memuat siswa:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await classController.deleteStudent(id);
      await loadStudents();
      setDeleteTarget(null);
    } catch (error: any) {
      // ConfirmDeleteModal tidak menangkap error dari onConfirm sendiri —
      // tanpa alert di sini, kegagalan hapus gagal secara senyap. Re-throw
      // supaya modal tahu untuk tetap terbuka (bukan ikut onClose seolah
      // berhasil), mengikuti pola handleGenerateMissingCodes di file ini.
      alert(error.message || 'Gagal menghapus siswa.');
      throw error;
    }
  }

  async function handleDeleteClass() {
    if (!workspaceId) return;
    try {
      await classController.deleteClass(workspaceId, className);
      // TIDAK menutup modal atau memanggil onBack() di sini — itu tugas
      // onSuccessClose pada ConfirmDeleteModal di bawah, supaya guru
      // sempat melihat "berhasil dihapus" sebelum berpindah ke daftar
      // kelas (lihat catatan onSuccessClose di ConfirmDeleteModal.tsx).
    } catch (error: any) {
      alert(error.message || 'Gagal menghapus kelas.');
      throw error;
    }
  }

  function openSettings() {
    setRenameValue(className);
    setRenameError('');
    setShowSettings(true);
  }

  async function handleRenameClass() {
    const normalized = normalizeClassName(renameValue);
    if (!normalized || normalized === className) {
      setShowSettings(false);
      return;
    }
    const validation = validateClassName(renameValue);
    if (!validation.valid) {
      setRenameError(validation.error);
      return;
    }
    if (!auth.currentUser) return;
    setRenaming(true);
    setRenameError('');
    try {
      const idToken = await auth.currentUser.getIdToken();
      await classController.submitRenameClass(idToken, className, validation.value);
      setShowSettings(false);
      onRenamed?.(validation.value);
    } catch (error: any) {
      setRenameError(error.message || 'Gagal mengganti nama kelas.');
    } finally {
      setRenaming(false);
    }
  }

  async function handleGenerateMissingCodes() {
    if (!workspaceId) return;
    setGenerating(true);
    try {
      const count = await classController.generateMissingAccessCodes(workspaceId, className);
      await loadStudents();
      alert(`${count} kode akses dibuat. Bagikan ke siswa untuk masuk ke Student Companion.`);
    } catch (error: any) {
      alert(error.message || 'Gagal membuat kode akses.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyCode(student: any) {
    try {
      await navigator.clipboard.writeText(student.accessCode);
      setCopiedId(student.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard API diblokir (mis. halaman non-HTTPS di HP) — kodenya
      // tetap terlihat di layar, jadi guru masih bisa menyalin manual.
      alert(`Kode akses ${student.name}: ${student.accessCode}`);
    }
  }

  async function handleCopyAllCodes() {
    if (students.length === 0) return;
    const text = buildStudentCodesShareText(className, students);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      // Sama seperti fallback handleCopyCode: clipboard API diblokir, jadi
      // teksnya ditampilkan langsung supaya guru masih bisa menyalin manual.
      alert(text);
    }
  }

  const missingCodeCount = students.filter((student) => !student.accessCode).length;

  if (loading) {
    return (
      <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-xs font-bold text-gray-500">Memuat data siswa...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-100 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider">Kelas {className}</h3>
          <p className="text-xs font-bold text-gray-400 mt-0.5">Total {students.length} Siswa</p>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={() => setShowAddStudent(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Siswa
          </button>
          <button
            onClick={handleCopyAllCodes}
            disabled={students.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 rounded-xl text-xs font-bold transition-all"
            title="Salin semua kode akses siswa di kelas ini untuk dibagikan sekaligus"
          >
            <Copy className="w-3.5 h-3.5" />
            Salin Semua Kode
          </button>
          <button
            onClick={openSettings}
            className="p-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl transition-all active:scale-95"
            title="Pengaturan Kelas"
            aria-label="Pengaturan Kelas"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          {students.length > 0 && (
            <button
              onClick={() => setConfirmDeleteClass(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-bold transition-all active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Hapus Kelas Ini
            </button>
          )}
          <button
            onClick={onBack}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all"
          >
            {backLabel}
          </button>
        </div>
      </div>

      {copiedAll && (
        <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-2xl text-[11px] font-bold text-emerald-700 flex items-center gap-2">
          <Check className="w-3.5 h-3.5 shrink-0" />
          Kode siswa berhasil disalin
        </div>
      )}

      {missingCodeCount > 0 && (
        <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-[11px] font-bold text-blue-800">
            {missingCodeCount} siswa belum punya kode akses Student Companion.
          </p>
          <button
            onClick={handleGenerateMissingCodes}
            disabled={generating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-[11px] font-bold transition-colors shadow-sm shrink-0"
          >
            {generating ? 'Membuat...' : 'Buatkan Kode'}
          </button>
        </div>
      )}

      {students.length === 0 ? (
        <p className="text-xs font-bold text-gray-400 text-center py-10">Belum ada siswa di kelas ini.</p>
      ) : (
        <div className="space-y-2.5">
          {students.map((student, idx) => (
            <div
              key={student.id}
              className="p-4 bg-gray-50 rounded-2xl flex justify-between items-center border border-gray-100 shadow-sm hover:border-emerald-200 transition-all"
            >
              <div className="flex items-center gap-4">
                <span className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-700 font-extrabold text-xs flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <div>
                  <p className="text-sm font-extrabold text-gray-900">{student.name}</p>
                  <p className="text-[10px] font-bold text-gray-500 mt-0.5">NIS: {student.nis || '-'}</p>
                  {student.accessCode && (
                    <button
                      onClick={() => handleCopyCode(student)}
                      className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 bg-white border border-gray-200 hover:border-blue-300 rounded-lg transition-colors"
                      title="Salin kode akses Student Companion"
                    >
                      <span className="text-[10px] font-extrabold tracking-widest text-blue-600">
                        {student.accessCode}
                      </span>
                      {copiedId === student.id ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3 text-gray-400" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              <button
                onClick={() => setDeleteTarget({ id: student.id, name: student.name, nis: student.nis || '-' })}
                className="p-3.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-colors active:scale-90 shrink-0"
                title="Hapus Siswa"
                aria-label={`Hapus Siswa ${student.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget!.id)}
        title="Hapus Siswa?"
        itemName={deleteTarget?.name || ""}
        itemDetail={`Kelas ${className} • NIS: ${deleteTarget?.nis || "-"}`}
        requireTyping={true}
        type="danger"
      />

      <Modal
        isOpen={showAddStudent}
        onClose={() => setShowAddStudent(false)}
        title={`Tambah Siswa ke Kelas ${className}`}
      >
        <div className="space-y-6">
          <AddStudentForm
            onAdded={() => {
              setShowAddStudent(false);
              loadStudents();
            }}
            lockedClassName={className}
          />
          <BulkImportForm
            onAdded={() => {
              setShowAddStudent(false);
              loadStudents();
            }}
            lockedClassName={className}
          />
        </div>
      </Modal>

      <ConfirmDeleteModal
        isOpen={confirmDeleteClass}
        onClose={() => setConfirmDeleteClass(false)}
        onConfirm={handleDeleteClass}
        onSuccessClose={() => {
          setConfirmDeleteClass(false);
          onBack();
        }}
        title="Hapus Seluruh Kelas Ini?"
        itemName={`Kelas ${className}`}
        itemDetail={`${students.length} siswa di kelas ini akan ikut terhapus semua, termasuk data presensi/nilai yang mereferensikan mereka tidak bisa dipulihkan.`}
        requireTyping={true}
        type="danger"
      />

      <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title="Pengaturan Kelas">
        <div className="space-y-4">
          <div>
            <Input
              label="Nama Kelas"
              value={renameValue}
              onChange={setRenameValue}
              placeholder="Contoh: XI F TEKNIK 2"
              maxLength={CLASS_NAME_MAX_LENGTH}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="text-[10px] text-gray-400 mt-1.5">
              Boleh mengandung spasi dan angka, mis. &quot;XI A KESEHATAN 1&quot;. Mengganti nama akan otomatis
              merapikan seluruh data terkait kelas ini (siswa, jurnal, presensi, nilai, tugas, pengumuman, jadwal) —
              termasuk akun Student Companion siswa, supaya mereka tidak kehilangan akses.
            </p>
          </div>
          {renameError && <p className="text-xs font-bold text-red-600">{renameError}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              disabled={renaming}
              className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-xl text-xs font-bold transition-colors"
            >
              Batal
            </button>
            <div className="flex-1">
              <Button
                onClick={handleRenameClass}
                loading={renaming}
                disabled={!normalizeClassName(renameValue) || normalizeClassName(renameValue) === className}
              >
                {renaming ? 'Menyimpan...' : 'Simpan Nama Baru'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
