import { triggerBrowserDownload } from './csvExport';

// "Arsip Lengkap" dari spec Download Data — satu file JSON berisi seluruh
// dataset yang dipilih guru, apa adanya (bukan diringkas). Dipilih JSON
// (bukan .zip berisi banyak CSV) supaya tidak perlu dependency baru
// (zip library) dan tetap portable/bisa diimpor ulang kalau nanti ada
// fitur impor.
export function downloadJsonBackup(filename: string, data: Record<string, unknown>) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  triggerBrowserDownload(blob, filename);
}
