import * as exportDataController from '../controllers/exportDataController';
import type { ExportScope } from '../controllers/exportDataController';
import { DateRange, PeriodPreset, PERIOD_PRESET_LABELS } from './periodRange';
import { EXPORT_COLUMNS, EXPORT_DATA_TYPE_LABELS } from './exportColumns';
import { downloadCsv } from './csvExport';
import { downloadJsonBackup } from './jsonBackupExport';
import { exportDataTablePdf } from './dataTablePdf';
import { getWitaDateString } from './witaDate';
import { ATTENDANCE_SUMMARY_COLUMNS, GRADE_SUMMARY_COLUMNS, summarizeAttendanceByClass, summarizeGradesByStudent } from './exportSummary';

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

function buildPdfSections(dataTypeKeys: string[], data: Record<string, Record<string, unknown>[]>, rangeLabel: string): PdfSection[] {
  const sections: PdfSection[] = [];
  for (const key of dataTypeKeys) {
    const rows = data[key] || [];
    if (key === 'attendances') {
      sections.push({ title: `Ringkasan Presensi — ${rangeLabel}`, columns: ATTENDANCE_SUMMARY_COLUMNS, rows: summarizeAttendanceByClass(rows) });
      sections.push({ title: 'Rincian Presensi', columns: EXPORT_COLUMNS[key] || [], rows });
      continue;
    }
    if (key === 'grades') {
      sections.push({ title: 'Ringkasan Nilai per Siswa', columns: GRADE_SUMMARY_COLUMNS, rows: summarizeGradesByStudent(rows) });
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
