'use client';

import React, { useEffect, useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal';
import ClassSelector from '../attendance/ClassSelector';
import * as classController from '@/lib/controllers/classController';
import * as academicYearController from '@/lib/controllers/academicYearController';
import * as dataCleanupController from '@/lib/controllers/dataCleanupController';
import { resolvePeriodRange, PeriodPreset, PERIOD_PRESET_LABELS, DateRange } from '@/lib/utils/periodRange';
import { DATA_LIFECYCLE_COLLECTIONS } from '@/lib/config/dataLifecycleCollections';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import type { AcademicYear } from '@/lib/services/academicYearService';

// Cleanup SENGAJA tidak menawarkan preset "Semua Data" (beda dari Download)
// — supaya guru tidak bisa tidak sengaja menghapus seluruh riwayat kelas
// tanpa batas periode sama sekali.
const CLEANUP_PRESETS: PeriodPreset[] = ['month', 'two_months', 'semester', 'academic_year', 'custom'];

export default function CleanupDataPanel() {
  const { workspaceId } = useWorkspace();
  const [classes, setClasses] = useState<string[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [scopeType, setScopeType] = useState<'all' | 'class'>('all');
  const [selectedClass, setSelectedClass] = useState('');
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [selectedYearId, setSelectedYearId] = useState('');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [dataTypeKeys, setDataTypeKeys] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ counts: Record<string, number>; total: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [resultMsg, setResultMsg] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    classController.fetchClassSummaries(workspaceId).then((list) => setClasses(list.map((s: any) => s.className)));
    academicYearController.fetchAcademicYears(workspaceId).then(setAcademicYears);
  }, [workspaceId]);

  function toggleDataType(key: string) {
    setPreview(null);
    setDataTypeKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function computeRange(): DateRange {
    if (preset === 'academic_year') {
      const year = academicYears.find((y) => y.id === selectedYearId);
      return resolvePeriodRange('academic_year', { academicYear: year || null });
    }
    if (preset === 'custom') {
      return resolvePeriodRange('custom', { customStartDate: customStart, customEndDate: customEnd });
    }
    return resolvePeriodRange(preset);
  }

  async function handlePreview() {
    if (!workspaceId) return;
    setError('');
    setResultMsg('');
    setPreviewing(true);
    try {
      const range = computeRange();
      const result = await dataCleanupController.fetchCleanupPreview(
        workspaceId,
        dataTypeKeys,
        range,
        scopeType === 'class' ? selectedClass : undefined
      );
      setPreview(result);
    } catch (err: any) {
      setError(err.message || 'Gagal menghitung data.');
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirmDelete() {
    if (!workspaceId) return;
    const range = computeRange();
    const deleted = await dataCleanupController.submitCleanup(
      workspaceId,
      dataTypeKeys,
      range,
      scopeType === 'class' ? selectedClass : undefined
    );
    const totalDeleted = Object.values(deleted).reduce((a, b) => a + b, 0);
    setResultMsg(`${totalDeleted} dokumen berhasil dihapus.`);
    setPreview(null);
    setShowConfirm(false);
  }

  const canPreview = dataTypeKeys.length > 0 && (scopeType === 'all' || !!selectedClass) &&
    (preset !== 'custom' || (customStart && customEnd)) && (preset !== 'academic_year' || !!selectedYearId);

  return (
    <Card className="space-y-4">
      <h3 className="text-sm font-bold text-nb-ink flex items-center gap-2">
        <Trash2 className="w-4 h-4 text-red-500" />
        Bersihkan Data
      </h3>
      <p className="text-xs text-nb-ink-muted">
        Hapus data percobaan/lama secara permanen. Ini <span className="font-bold text-red-500">berbeda dari Arsip</span> —
        data yang dihapus di sini tidak bisa dikembalikan.
      </p>

      <div>
        <label className="text-xs font-bold text-nb-ink block mb-1.5">Cakupan Kelas</label>
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => { setScopeType('all'); setPreview(null); }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors ${scopeType === 'all' ? 'bg-nb-green text-white' : 'bg-gray-100 text-nb-ink-muted'}`}
          >
            Semua Kelas
          </button>
          <button
            type="button"
            onClick={() => { setScopeType('class'); setPreview(null); }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors ${scopeType === 'class' ? 'bg-nb-green text-white' : 'bg-gray-100 text-nb-ink-muted'}`}
          >
            Per Kelas
          </button>
        </div>
        {scopeType === 'class' && (
          <ClassSelector classes={classes} selected={selectedClass} onChange={(c) => { setSelectedClass(c); setPreview(null); }} />
        )}
      </div>

      <div>
        <label className="text-xs font-bold text-nb-ink block mb-1.5">Periode</label>
        <select
          value={preset}
          onChange={(e) => { setPreset(e.target.value as PeriodPreset); setPreview(null); }}
          className="w-full p-3 bg-nb-paper border border-nb-control rounded-xl text-xs text-nb-ink outline-none focus:ring-2 focus:ring-nb-green"
        >
          {CLEANUP_PRESETS.map((p) => (
            <option key={p} value={p}>{PERIOD_PRESET_LABELS[p]}</option>
          ))}
        </select>
        {preset === 'academic_year' && (
          <select
            value={selectedYearId}
            onChange={(e) => { setSelectedYearId(e.target.value); setPreview(null); }}
            className="w-full mt-2 p-3 bg-nb-paper border border-nb-control rounded-xl text-xs text-nb-ink outline-none focus:ring-2 focus:ring-nb-green"
          >
            <option value="">Pilih tahun ajaran...</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>{y.label}</option>
            ))}
          </select>
        )}
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Input label="Dari" type="date" value={customStart} onChange={(v) => { setCustomStart(v); setPreview(null); }} />
            <Input label="Sampai" type="date" value={customEnd} onChange={(v) => { setCustomEnd(v); setPreview(null); }} />
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-bold text-nb-ink block mb-1.5">Jenis Data</label>
        <div className="grid grid-cols-2 gap-2">
          {DATA_LIFECYCLE_COLLECTIONS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 p-2.5 bg-nb-workspace rounded-xl text-xs font-bold text-nb-ink cursor-pointer">
              <input type="checkbox" checked={dataTypeKeys.includes(c.key)} onChange={() => toggleDataType(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-nb-ink-muted mt-1.5">
          Nilai &amp; daftar siswa tidak bisa dibersihkan lewat sini (tidak punya &quot;tanggal periode&quot; yang andal).
        </p>
      </div>

      {error && <p className="text-xs font-bold text-red-600">{error}</p>}
      {resultMsg && <p className="text-xs font-bold text-emerald-600">{resultMsg}</p>}

      <Button onClick={handlePreview} loading={previewing} disabled={!canPreview}>
        {previewing ? 'Menghitung...' : 'Preview Jumlah Data'}
      </Button>

      {preview && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
          <p className="text-xs font-extrabold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            {preview.total} dokumen akan dihapus
          </p>
          <div className="text-xs text-amber-700 space-y-0.5">
            {Object.entries(preview.counts).map(([key, count]) => {
              const config = DATA_LIFECYCLE_COLLECTIONS.find((c) => c.key === key);
              return <p key={key}>{config?.label || key}: {count}</p>;
            })}
          </div>
          <Button
            className="bg-red-600 hover:bg-red-700"
            disabled={preview.total === 0}
            onClick={() => setShowConfirm(true)}
          >
            Hapus Data Ini
          </Button>
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmDelete}
        title="Hapus Data Secara Permanen?"
        itemName={`${preview?.total || 0} dokumen`}
        itemDetail={`Periode: ${PERIOD_PRESET_LABELS[preset]} • Cakupan: ${scopeType === 'class' ? `Kelas ${selectedClass}` : 'Semua Kelas'}`}
        requireTyping={true}
        type="danger"
      />
    </Card>
  );
}
