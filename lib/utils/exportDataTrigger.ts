import * as exportDataController from '../controllers/exportDataController';
import type { ExportScope } from '../controllers/exportDataController';
import { DateRange, PeriodPreset, PERIOD_PRESET_LABELS } from './periodRange';
import { EXPORT_COLUMNS, EXPORT_DATA_TYPE_LABELS } from './exportColumns';
import { downloadCsv } from './csvExport';
import { downloadJsonBackup } from './jsonBackupExport';
import { exportDataTablePdf } from './dataTablePdf';
import { getWitaDateString } from './witaDate';

export type ExportFormat = 'pdf' | 'csv' | 'json';

function scopeLabel(scope: ExportScope) {
  return scope.type === 'class' ? `Kelas ${scope.className}` : 'Semua Kelas';
}

function fileBaseName(scope: ExportScope, preset: PeriodPreset) {
  const scopePart = scope.type === 'class' ? scope.className.replace(/\s+/g, '-') : 'SemuaKelas';
  const datePart = getWitaDateString();
  return `Data-${scopePart}-${preset}-${datePart}`;
}

type PdfSection = { title: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[] };

function buildPdfSections(dataTypeKeys: string[], data: Record<string, any[]>, rangeLabel: string): PdfSection[] {
  const sections: PdfSection[] = [];
  for (const key of dataTypeKeys) {
    const rows = data[key] || [];
    if (key === 'attendances') {
      const counts = new Map<string, { className: string; sessions: Set<string>; total: number; hadir: number; izin: number; sakit: number; alpha: number; dispensasi: number; terlambat: number }>();
      rows.forEach((row) => {
        const className = String(row.className || 'Tanpa kelas');
        const item = counts.get(className) || { className, sessions: new Set<string>(), total: 0, hadir: 0, izin: 0, sakit: 0, alpha: 0, dispensasi: 0, terlambat: 0 };
        item.sessions.add(`${row.date || '-'}|${row.subject || '-'}`);
        item.total += 1;
        const status = String(row.status || '').trim().toLocaleLowerCase('id-ID');
        if (status === 'hadir') item.hadir += 1;
        else if (status === 'izin') item.izin += 1;
        else if (status === 'sakit') item.sakit += 1;
        else if (status === 'alpha' || status === 'alpa' || status === 'tidak hadir') item.alpha += 1;
        else if (status === 'dispensasi') item.dispensasi += 1;
        if (String(row.late || '').trim().toLocaleLowerCase('id-ID') === 'ya') item.terlambat += 1;
        counts.set(className, item);
      });
      const summary = Array.from(counts.values()).sort((a, b) => a.className.localeCompare(b.className, 'id')).map((item) => ({
        className: item.className,
        sessions: item.sessions.size,
        total: item.total,
        hadir: item.hadir,
        izin: item.izin,
        sakit: item.sakit,
        alpha: item.alpha,
        dispensasi: item.dispensasi,
        terlambat: item.terlambat,
        hadirPercent: item.total ? `${Math.round((item.hadir / item.total) * 100)}%` : '0%',
      }));
      sections.push({
        title: `Ringkasan Presensi — ${rangeLabel}`,
        columns: [
          { key: 'className', label: 'Kelas' }, { key: 'sessions', label: 'Sesi tercatat' },
          { key: 'total', label: 'Catatan siswa' }, { key: 'hadir', label: 'Hadir' },
          { key: 'izin', label: 'Izin' }, { key: 'sakit', label: 'Sakit' },
          { key: 'alpha', label: 'Tidak hadir' }, { key: 'dispensasi', label: 'Dispensasi' },
          { key: 'terlambat', label: 'Terlambat' }, { key: 'hadirPercent', label: '% Hadir' },
        ],
        rows: summary,
      });
      sections.push({ title: 'Rincian Presensi', columns: EXPORT_COLUMNS[key] || [], rows });
      continue;
    }
    if (key === 'grades') {
      const students = new Map<string, { className: string; studentName: string; nis: string; total: number; count: number; highest: number; lowest: number }>();
      rows.forEach((row) => {
        const score = Number(row.score);
        if (!Number.isFinite(score)) return;
        const id = `${row.className || ''}| ${row.studentName || ''}| ${row.nis || ''}`;
        const item = students.get(id) || { className: String(row.className || '-'), studentName: String(row.studentName || '-'), nis: String(row.nis || '-'), total: 0, count: 0, highest: score, lowest: score };
        item.total += score;
        item.count += 1;
        item.highest = Math.max(item.highest, score);
        item.lowest = Math.min(item.lowest, score);
        students.set(id, item);
      });
      const summary = Array.from(students.values()).sort((a, b) => a.className.localeCompare(b.className, 'id') || a.studentName.localeCompare(b.studentName, 'id')).map((item) => ({
        className: item.className, studentName: item.studentName, nis: item.nis, components: item.count,
        average: Number((item.total / item.count).toFixed(2)), highest: item.highest, lowest: item.lowest,
      }));
      sections.push({
        title: 'Ringkasan Nilai per Siswa',
        columns: [
          { key: 'className', label: 'Kelas' }, { key: 'studentName', label: 'Nama Siswa' },
          { key: 'nis', label: 'NIS' }, { key: 'components', label: 'Komponen terisi' },
          { key: 'average', label: 'Rata-rata' }, { key: 'highest', label: 'Nilai tertinggi' },
          { key: 'lowest', label: 'Nilai terendah' },
        ],
        rows: summary,
      });
      sections.push({ title: 'Rincian Nilai per Komponen', columns: EXPORT_COLUMNS[key] || [], rows });
      continue;
    }
    sections.push({ title: EXPORT_DATA_TYPE_LABELS[key] || key, columns: EXPORT_COLUMNS[key] || [], rows });
  }
  return sections;
}

export async function triggerExport(params: {
  workspaceId: string;
  dataTypeKeys: string[];
  range: DateRange;
  preset: PeriodPreset;
  scope: ExportScope;
  format: ExportFormat;
}) {
  const { workspaceId, dataTypeKeys, range, preset, scope, format } = params;
  if (dataTypeKeys.length === 0) throw new Error('Pilih minimal satu jenis data untuk diunduh.');

  const data = await exportDataController.fetchExportData(workspaceId, dataTypeKeys, range, scope);
  const baseName = fileBaseName(scope, preset);

  if (format === 'json') {
    downloadJsonBackup(`${baseName}.json`, {
      exportedAt: new Date().toISOString(),
      scope: scopeLabel(scope),
      periode: PERIOD_PRESET_LABELS[preset],
      rentangTanggal: range,
      data,
    });
    return;
  }

  if (format === 'pdf') {
    exportDataTablePdf({
      documentTitle: 'Laporan Data — Teacher Workspace',
      subtitle: `${scopeLabel(scope)} • ${PERIOD_PRESET_LABELS[preset]}`,
      sections: buildPdfSections(dataTypeKeys, data, PERIOD_PRESET_LABELS[preset]),
      filename: `${baseName}.pdf`,
    });
    return;
  }

  // CSV: satu file per jenis data (format CSV tidak mendukung banyak
  // skema kolom dalam satu file) — dipicu berurutan dengan jeda kecil
  // supaya browser tidak menahan unduhan beruntun dari satu klik.
  for (let i = 0; i < dataTypeKeys.length; i++) {
    const key = dataTypeKeys[i];
    const label = (EXPORT_DATA_TYPE_LABELS[key] || key).replace(/\s+/g, '-');
    await new Promise((resolve) => setTimeout(resolve, i * 300));
    downloadCsv(`${baseName}-${label}.csv`, data[key] || [], EXPORT_COLUMNS[key] || []);
  }
}
