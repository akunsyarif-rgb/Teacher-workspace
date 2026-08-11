// Generator CSV murni (tanpa dependency baru) — dibuka Excel/Google Sheets
// langsung tanpa perlu format .xlsx biner. Escaping RFC 4180: field yang
// mengandung koma/kutip/baris baru dibungkus tanda kutip ganda, kutip di
// dalamnya digandakan.
function escapeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvField(row[c.key])).join(','));
  // \r\n + BOM — supaya Excel Windows (target paling umum di sekolah)
  // membaca separator baris & karakter non-ASCII (nama siswa berhuruf
  // khusus) dengan benar tanpa perlu "Import Data" manual.
  return '﻿' + [header, ...body].join('\r\n');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns: { key: string; label: string }[]) {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerBrowserDownload(blob, filename);
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
