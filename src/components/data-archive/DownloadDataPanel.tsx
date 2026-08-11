'use client';

import React, { useEffect, useState } from 'react';
import { Download, FileText, Table, FileJson } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ClassSelector from '../attendance/ClassSelector';
import * as classController from '@/lib/controllers/classController';
import * as academicYearController from '@/lib/controllers/academicYearController';
import { resolvePeriodRange, PeriodPreset, PERIOD_PRESET_LABELS, DateRange } from '@/lib/utils/periodRange';
import { EXPORT_DATA_TYPE_LABELS } from '@/lib/utils/exportColumns';
import { triggerExport, ExportFormat } from '@/lib/utils/exportDataTrigger';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import type { AcademicYear } from '@/lib/services/academicYearService';

const DOWNLOAD_PRESETS: PeriodPreset[] = ['month', 'two_months', 'semester', 'academic_year', 'custom', 'all'];
const ALL_DATA_TYPES = Object.keys(EXPORT_DATA_TYPE_LABELS);

const FORMAT_OPTIONS: { value: ExportFormat; label: string; hint: string; icon: any }[] = [
  { value: 'pdf', label: 'PDF', hint: 'Laporan siap cetak', icon: FileText },
  { value: 'csv', label: 'CSV', hint: 'Untuk Excel/Sheets', icon: Table },
  { value: 'json', label: 'Arsip Lengkap', hint: 'Backup JSON', icon: FileJson },
];

export default function DownloadDataPanel() {
  const { workspaceId } = useWorkspace();
  const [classes, setClasses] = useState<string[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [scopeType, setScopeType] = useState<'all' | 'class'>('all');
  const [selectedClass, setSelectedClass] = useState('');
  const [preset, setPreset] = useState<PeriodPreset>('semester');
  const [selectedYearId, setSelectedYearId] = useState('');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [dataTypeKeys, setDataTypeKeys] = useState<string[]>(['journals', 'attendances']);
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    classController.fetchClassSummaries(workspaceId).then((list) => setClasses(list.map((s: any) => s.className)));
    academicYearController.fetchAcademicYears(workspaceId).then(setAcademicYears);
  }, [workspaceId]);

  function toggleDataType(key: string) {
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

  async function handleDownload() {
    if (!workspaceId) return;
    setError('');
    setSuccessMsg('');
    setDownloading(true);
    try {
      const range = computeRange();
      await triggerExport({
        workspaceId,
        dataTypeKeys,
        range,
        preset,
        scope: scopeType === 'class' ? { type: 'class', className: selectedClass } : { type: 'all' },
        format,
      });
      setSuccessMsg('Unduhan dimulai — cek folder Download perangkat Anda.');
    } catch (err: any) {
      setError(err.message || 'Gagal mengunduh data.');
    } finally {
      setDownloading(false);
    }
  }

  const canDownload = dataTypeKeys.length > 0 && (scopeType === 'all' || !!selectedClass) &&
    (preset !== 'custom' || (customStart && customEnd)) && (preset !== 'academic_year' || !!selectedYearId);

  return (
    <Card className="space-y-4">
      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
        <Download className="w-4 h-4 text-blue-600" />
        Download Data
      </h3>
      <p className="text-xs text-gray-500">
        Untuk export cepat presensi satu kelas, tetap pakai &quot;Export PDF Rekap&quot; di Kelas Aktif → Presensi → Riwayat.
        Ini untuk unduhan lintas kelas/periode.
      </p>

      <div>
        <label className="text-xs font-bold text-gray-700 block mb-1.5">Cakupan Kelas</label>
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => setScopeType('all')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors ${scopeType === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Semua Kelas
          </button>
          <button
            type="button"
            onClick={() => setScopeType('class')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors ${scopeType === 'class' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Per Kelas
          </button>
        </div>
        {scopeType === 'class' && (
          <ClassSelector classes={classes} selected={selectedClass} onChange={setSelectedClass} />
        )}
      </div>

      <div>
        <label className="text-xs font-bold text-gray-700 block mb-1.5">Periode</label>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as PeriodPreset)}
          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-600"
        >
          {DOWNLOAD_PRESETS.map((p) => (
            <option key={p} value={p}>{PERIOD_PRESET_LABELS[p]}</option>
          ))}
        </select>
        {preset === 'academic_year' && (
          <select
            value={selectedYearId}
            onChange={(e) => setSelectedYearId(e.target.value)}
            className="w-full mt-2 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Pilih tahun ajaran...</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>{y.label}</option>
            ))}
          </select>
        )}
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Input label="Dari" type="date" value={customStart} onChange={setCustomStart} />
            <Input label="Sampai" type="date" value={customEnd} onChange={setCustomEnd} />
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-bold text-gray-700 block mb-1.5">Jenis Data</label>
        <div className="grid grid-cols-2 gap-2">
          {ALL_DATA_TYPES.map((key) => (
            <label key={key} className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-xl text-xs font-bold text-gray-700 cursor-pointer">
              <input type="checkbox" checked={dataTypeKeys.includes(key)} onChange={() => toggleDataType(key)} />
              {EXPORT_DATA_TYPE_LABELS[key]}
            </label>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">Nilai selalu data saat ini (tidak difilter periode).</p>
      </div>

      <div>
        <label className="text-xs font-bold text-gray-700 block mb-1.5">Format</label>
        <div className="grid grid-cols-3 gap-2">
          {FORMAT_OPTIONS.map(({ value, label, hint, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFormat(value)}
              className={`p-3 rounded-xl border text-center transition-colors ${
                format === value ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <Icon className="w-4 h-4 mx-auto mb-1" />
              <p className="text-[11px] font-bold">{label}</p>
              <p className="text-[9px] text-gray-400">{hint}</p>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs font-bold text-red-600">{error}</p>}
      {successMsg && <p className="text-xs font-bold text-emerald-600">{successMsg}</p>}

      <Button onClick={handleDownload} loading={downloading} disabled={!canDownload}>
        {downloading ? 'Menyiapkan...' : 'Unduh'}
      </Button>
    </Card>
  );
}
