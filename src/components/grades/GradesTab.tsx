'use client';

import React, { useState, useEffect } from 'react';
import { CheckCircle2, Table, Plus, Save } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import GradesTable from './GradesTable';
import GradeColumnModal from './GradeColumnModal';
import * as gradeController from '@/lib/controllers/gradeController';
import * as studentController from '@/lib/controllers/classController';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import { SkeletonTable, SkeletonText } from '../ui/Skeleton';

type GradesTabProps = {
  className: string;
};

export default function GradesTab({ className }: GradesTabProps) {
  const { workspaceId } = useWorkspace();
  const [columns, setColumns] = useState<any[]>([]);
  const [grades, setGrades] = useState<Record<string, Record<string, string>>>({});
  const [students, setStudents] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (className && workspaceId) {
      loadAllData();
    }
  }, [className, workspaceId]);

  async function loadAllData() {
    setLoadingData(true);
    await Promise.all([loadData(), loadStudents()]);
    setLoadingData(false);
  }

  async function loadData() {
    if (!className || !workspaceId) return;
    try {
      const data = await gradeController.fetchGradeData(workspaceId, className);
      setColumns(data.columns);
      setGrades(data.grades);
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

  async function handleSaveAll() {
    if (!workspaceId) return;
    setLoading(true);
    setSuccess(false);
    try {
      await gradeController.saveGrades(workspaceId, className, grades);
      setSuccess(true);
    } catch (error: any) {
      alert(error.message || 'Gagal menyimpan nilai.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddColumn(title: string, type: string) {
    if (!workspaceId) return;
    await gradeController.addColumn(workspaceId, className, title, type);
    await loadData();
  }

  async function handleDeleteColumn(columnId: string) {
    if (!confirm('Hapus kolom nilai ini beserta seluruh nilai siswa di dalamnya?')) return;
    await gradeController.removeColumn(columnId);
    await loadData();
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
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <Button variant="secondary" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            <span>Tambah Kolom</span>
          </Button>
          <Button onClick={handleSaveAll} loading={loading}>
            <Save className="w-4 h-4" />
            <span>{loading ? 'Menyimpan...' : 'Simpan Semua Nilai'}</span>
          </Button>
        </div>
      </Card>

      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Semua perubahan nilai berhasil disimpan!</span>
        </div>
      )}

      <GradeColumnModal isOpen={showModal} onClose={() => setShowModal(false)} onSubmit={handleAddColumn} />

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
            onScoreChange={handleScoreChange}
            onDeleteColumn={handleDeleteColumn}
          />
        )}
      </div>
    </div>
  );
}
