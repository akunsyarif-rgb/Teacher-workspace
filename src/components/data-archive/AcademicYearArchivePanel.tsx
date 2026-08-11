'use client';

import React, { useEffect, useState } from 'react';
import { Archive, CheckCircle2, Plus, ChevronRight, ArrowLeft } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import * as academicYearController from '@/lib/controllers/academicYearController';
import * as dataArchiveController from '@/lib/controllers/dataArchiveController';
import { EXPORT_DATA_TYPE_LABELS } from '@/lib/utils/exportColumns';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import type { AcademicYear } from '@/lib/services/academicYearService';

const ARCHIVE_TYPE_KEYS = ['journals', 'attendances', 'assignments', 'submissions', 'announcements'];

export default function AcademicYearArchivePanel() {
  const { workspaceId } = useWorkspace();
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [viewingYear, setViewingYear] = useState<AcademicYear | null>(null);
  const [viewCounts, setViewCounts] = useState<Record<string, number> | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);

  useEffect(() => {
    if (workspaceId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function load() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const list = await academicYearController.fetchAcademicYears(workspaceId);
      setYears(list);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartNewYear() {
    if (!workspaceId) return;
    setSaving(true);
    setError('');
    try {
      await academicYearController.submitStartNewAcademicYear(workspaceId, label, startDate);
      setLabel('');
      setStartDate('');
      setShowNewForm(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'Gagal membuat tahun ajaran baru.');
    } finally {
      setSaving(false);
    }
  }

  async function openYear(year: AcademicYear) {
    setViewingYear(year);
    setViewCounts(null);
    setLoadingCounts(true);
    try {
      if (!workspaceId) return;
      const { counts } = await dataArchiveController.fetchArchiveCounts(
        workspaceId,
        { startDate: year.startDate, endDate: year.endDate },
        undefined
      );
      setViewCounts(counts);
    } finally {
      setLoadingCounts(false);
    }
  }

  if (viewingYear) {
    return (
      <Card className="space-y-4">
        <button
          onClick={() => setViewingYear(null)}
          className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali ke Daftar Tahun Ajaran
        </button>
        <div>
          <h3 className="text-sm font-extrabold text-gray-900">{viewingYear.label}</h3>
          <p className="text-xs text-gray-500">
            {viewingYear.startDate} — {viewingYear.endDate || 'sekarang'}
            {viewingYear.isActive && <span className="text-emerald-600 font-bold"> • Aktif</span>}
          </p>
        </div>
        <p className="text-[11px] text-gray-400">
          Data arsip ini tetap bisa dibaca untuk kroscek/laporan, tapi tidak ikut alur kerja tahun berjalan.
        </p>
        {loadingCounts ? (
          <p className="text-xs text-gray-400">Memuat ringkasan...</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {ARCHIVE_TYPE_KEYS.map((key) => (
              <div key={key} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-lg font-extrabold text-gray-900">{viewCounts?.[key] ?? 0}</p>
                <p className="text-[10px] font-bold text-gray-500">{EXPORT_DATA_TYPE_LABELS[key]}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Archive className="w-4 h-4 text-blue-600" />
          Arsip Tahun Ajaran
        </h3>
        <Button className="w-auto px-4" onClick={() => setShowNewForm((v) => !v)}>
          <Plus className="w-4 h-4" />
          <span>Tahun Baru</span>
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Data tahun berjalan adalah data aktif. Data lama TIDAK otomatis terhapus — tetap tersimpan di sini sebagai
        arsip.
      </p>

      {showNewForm && (
        <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-3">
          <Input label="Label Tahun Ajaran" value={label} onChange={setLabel} placeholder="Contoh: 2026/2027" />
          <Input label="Tanggal Mulai" type="date" value={startDate} onChange={setStartDate} />
          {error && <p className="text-xs font-bold text-red-600">{error}</p>}
          <p className="text-[10px] text-gray-400">
            Tahun ajaran yang sedang aktif (kalau ada) otomatis ditutup sehari sebelum tanggal ini. Roster/nama
            kelas TIDAK ikut berubah — atur sendiri lewat Manajemen Kelas.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowNewForm(false)}>
              Batal
            </Button>
            <Button onClick={handleStartNewYear} loading={saving}>
              {saving ? 'Menyimpan...' : 'Mulai Tahun Ajaran Ini'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400">Memuat...</p>
      ) : years.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">Belum ada tahun ajaran tercatat.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {years.map((year) => (
            <button
              key={year.id}
              onClick={() => openYear(year)}
              className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors -mx-2 px-2 rounded-xl"
            >
              <div className="flex items-center gap-2">
                {year.isActive && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                <div>
                  <p className="text-sm font-extrabold text-gray-900">{year.label}</p>
                  <p className="text-[10px] text-gray-400">
                    {year.isActive ? 'Aktif' : `Arsip • s.d. ${year.endDate}`}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
