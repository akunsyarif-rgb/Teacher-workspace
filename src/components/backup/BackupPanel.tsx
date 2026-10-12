'use client';

import React, { useState } from 'react';
import { Download, Lock, LockOpen, Paperclip, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import Button from '@/src/components/ui/Button';
import InlineAlert from '@/src/components/ui/InlineAlert';
import * as backup from '@/lib/controllers/backupController';

type Phase = 'idle' | 'working' | 'done';

// Berkas diserahkan ke mekanisme unduhan perangkat (Files/iCloud Drive/Google Drive dapat dipilih dari dialog simpan/berbagi perangkat).
function saveBytes(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const mb = (n: number) => (n / 1024 / 1024).toFixed(n > 1024 * 1024 ? 1 : 2);
const STATUS_LABEL: Record<string, string> = { included: 'Termasuk', skipped_by_role: 'Tidak termasuk (di luar hak akses Anda)' };

export default function BackupPanel() {
  const [encrypt, setEncrypt] = useState(true);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<backup.BackupResult | null>(null);
  const [att, setAtt] = useState<{ busy: boolean; msg: string; error: string }>({ busy: false, msg: '', error: '' });
  const [open, setOpen] = useState<{ file: File | null; pass: string; busy: boolean; msg: string; error: string }>({ file: null, pass: '', busy: false, msg: '', error: '' });

  const passError = encrypt ? backup.validatePassphrase(pass, confirm) : null;
  const canStart = phase !== 'working' && !passError;

  async function start() {
    setError(''); setResult(null); setPhase('working'); setStep('Menyiapkan dan mengunduh data… (jangan tutup halaman ini)');
    try {
      const r = await backup.createBackup(encrypt ? pass : '');
      if (encrypt) setStep('Mengenkripsi arsip di perangkat ini…');
      saveBytes(r.filename, r.bytes);
      setResult(r); setPhase('done');
    } catch (e) {
      setError(backup.describeBackupError(e)); setPhase('idle');
    }
  }

  async function startAttachments() {
    setAtt({ busy: true, msg: 'Menyiapkan daftar lampiran…', error: '' });
    try {
      const r = await backup.downloadAttachments(encrypt ? pass : '', saveBytes, (p) =>
        setAtt({ busy: true, msg: p.total === 0 ? 'Tidak ada lampiran.' : `Mengunduh lampiran: ${p.files}/${p.total} file (bagian ${p.part})…`, error: '' }));
      setAtt({ busy: false, msg: r.files === 0 ? 'Tidak ada lampiran tugas di Supabase untuk diunduh.' : `Selesai: ${r.files} file dalam ${r.parts} berkas ZIP.${r.skipped ? ` PERHATIAN: ${r.skipped} file terlalu besar (>40 MB) dan TIDAK diunduh; tercatat di part-manifest.json tiap bagian.` : ''} Periksa part-manifest.json untuk file hilang/gagal.`, error: '' });
    } catch (e) {
      setAtt({ busy: false, msg: '', error: `${backup.describeBackupError(e)} Bagian yang sudah terunduh tetap tersimpan; ulangi untuk mengunduh semuanya.` });
    }
  }

  async function openArchive() {
    if (!open.file) return;
    setOpen((o) => ({ ...o, busy: true, msg: '', error: '' }));
    try {
      const r = await backup.decryptBackupFile(new Uint8Array(await open.file.arrayBuffer()), open.pass, open.file.name);
      saveBytes(r.filename, r.bytes);
      setOpen((o) => ({ ...o, busy: false, msg: `Arsip dibuka dan disimpan sebagai ${r.filename}.`, pass: '' }));
    } catch (e) {
      setOpen((o) => ({ ...o, busy: false, error: backup.describeBackupError(e) }));
    }
  }

  const s = result?.summary;
  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 space-y-3">
        <p className="text-sm font-extrabold text-gray-900">Unduh Backup Data</p>
        <p className="text-xs text-gray-600">
          Menyimpan salinan data workspace Anda (siswa, kelas, jurnal, presensi, nilai, tugas, dan lainnya) ke satu berkas ZIP di perangkat Anda.
          Bisa dilakukan kapan saja; simpan berkasnya di Files, iCloud Drive, atau Google Drive pribadi Anda.
        </p>
        <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-50 border border-amber-100 text-[11px] text-amber-800">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Berkas memuat data pribadi siswa, termasuk kode akses siswa. Jangan dibagikan. Enkripsi sangat disarankan, terutama bila disimpan di cloud.</span>
        </div>

        <label className="flex items-start gap-2 text-xs font-bold text-gray-800">
          <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} className="mt-0.5" disabled={phase === 'working'} />
          <span className="flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Lindungi dengan kata sandi (disarankan)</span>
        </label>
        {encrypt && (
          <div className="space-y-2">
            <input type="password" autoComplete="new-password" placeholder={`Kata sandi arsip (min. ${backup.MIN_PASSPHRASE} karakter)`} value={pass} onChange={(e) => setPass(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs bg-white text-gray-900" disabled={phase === 'working'} />
            <input type="password" autoComplete="new-password" placeholder="Ulangi kata sandi" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs bg-white text-gray-900" disabled={phase === 'working'} />
            {(pass || confirm) && passError && <p className="text-[11px] font-bold text-red-600">{passError}</p>}
            <p className="text-[11px] text-gray-500">Kata sandi hanya dipakai di perangkat ini dan <b>tidak bisa dipulihkan</b>. Jika hilang, arsip tidak bisa dibuka. Catat di tempat aman.</p>
          </div>
        )}
        {!encrypt && <p className="text-[11px] font-bold text-red-600">Tanpa kata sandi, siapa pun yang memegang berkas dapat membaca data siswa.</p>}

        <InlineAlert message={error} onDismiss={() => setError('')} />
        <Button onClick={start} disabled={!canStart} loading={phase === 'working'}>
          <Download className="w-4 h-4" /> {phase === 'working' ? 'Memproses…' : 'Unduh Backup'}
        </Button>
        {phase === 'working' && <p role="status" aria-live="polite" className="text-[11px] font-bold text-blue-700">{step}</p>}
      </div>

      {phase === 'done' && result && (
        <div role="status" className="bg-white p-5 rounded-3xl shadow-sm border border-emerald-100 space-y-3" data-testid="backup-result">
          <p className="flex items-center gap-2 text-sm font-extrabold text-emerald-700"><CheckCircle2 className="w-5 h-5" /> Backup berhasil diunduh</p>
          <p className="text-xs text-gray-600">
            Berkas: <b>{result.filename}</b> ({mb(result.bytes.length)} MB){result.encrypted ? ', terenkripsi' : ', TIDAK terenkripsi'}.
            Cari di folder Unduhan/Files perangkat Anda, lalu pindahkan ke iCloud Drive atau Google Drive pribadi bila perlu.
          </p>
          {s ? (
            <>
              <div className="text-xs text-gray-700">
                <p className="font-bold text-gray-900">Isi arsip ({s.totalDocs} dokumen)</p>
                <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                  {s.collections.map((c) => (
                    <li key={c.name} className="flex justify-between gap-2"><span>{c.name}</span><span className={c.status === 'included' ? 'font-bold' : 'text-gray-500'}>{c.status === 'included' ? c.count : '—'}</span></li>
                  ))}
                </ul>
                {s.collections.some((c) => c.status !== 'included') && (
                  <p className="mt-1 text-[11px] text-gray-500">— = {STATUS_LABEL.skipped_by_role.toLowerCase()}: catatan siswa/prestasi hanya untuk wali kelas atau admin.</p>
                )}
              </div>
              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-100 text-[11px] text-amber-900 space-y-1">
                <p className="flex items-center gap-1 font-bold"><AlertTriangle className="w-3.5 h-3.5" /> Backup ini BELUM mencakup semuanya</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Ulangan Harian: {s.ulangan.status === 'included' ? `termasuk (${s.ulangan.exams ?? 0} ulangan, sebagai JSON arsip${s.ulangan.resultsSkipped ? `; hasil ${s.ulangan.resultsSkipped} ulangan yang belum ditutup tidak ikut` : ''})` : s.ulangan.status === 'not_enabled' ? 'tidak ikut — fitur belum diaktifkan' : 'GAGAL diekspor — coba lagi nanti'}.</li>
                  <li>Lampiran tugas siswa: {s.attachments.count} referensi tercatat; isi file diunduh terpisah lewat tombol “Unduh Lampiran” di bawah (hanya yang tersimpan di Supabase).</li>
                  {s.gaps.filter((g) => g.source !== 'supabase_storage' && g.source !== 'restore_ulangan').map((g) => <li key={g.source}>{g.detail}</li>)}
                  {s.excluded.length > 0 && <li>Tidak diikutkan: {s.excluded.map((e) => e.name).join(', ')} (alasan ada di berkas manifest.json).</li>}
                  {s.unrecognized.length > 0 && <li>Koleksi yang tidak dikenali dan tidak diekspor: {s.unrecognized.join(', ')}.</li>}
                </ul>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-gray-500">Ringkasan tidak dapat ditampilkan di browser ini. Daftar isi dan cakupan ada di berkas manifest.json di dalam arsip. Ingat: backup ini tidak mencakup semuanya (akun login, lampiran file, Ulangan Harian bila nonaktif).</p>
          )}
        </div>
      )}

      <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 space-y-3">
        <p className="flex items-center gap-2 text-sm font-extrabold text-gray-900"><Paperclip className="w-4 h-4" /> Lampiran Tugas Siswa</p>
        <p className="text-xs text-gray-600">Mengunduh isi file lampiran (foto/PDF jawaban siswa) dalam beberapa berkas ZIP kecil (±40 MB per bagian). Kata sandi di atas ikut dipakai bila enkripsi aktif. Lampiran lama di Firebase Storage dan tautan Google Drive siswa tidak ikut diunduh (hanya tercatat di arsip data).</p>
        <InlineAlert message={att.error} onDismiss={() => setAtt((a) => ({ ...a, error: '' }))} />
        <Button variant="secondary" onClick={startAttachments} disabled={att.busy || phase === 'working' || !!passError} loading={att.busy}>Unduh Lampiran</Button>
        {att.msg && <p role="status" aria-live="polite" className="text-[11px] font-bold text-gray-700">{att.msg}</p>}
        <p className="text-[11px] text-gray-500">Peramban dapat meminta izin mengunduh banyak berkas; pilih “Izinkan”.</p>
      </div>

      <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 space-y-3">
        <p className="flex items-center gap-2 text-sm font-extrabold text-gray-900"><LockOpen className="w-4 h-4" /> Buka Arsip Terenkripsi</p>
        <p className="text-xs text-gray-600">Untuk membaca isi berkas <b>.zip.enc</b>: pilih berkas dan masukkan kata sandinya. Hasilnya ZIP biasa; dibuat di perangkat ini dan tidak dikirim ke server.</p>
        <input type="file" accept=".enc" aria-label="Berkas arsip terenkripsi" onChange={(e) => setOpen((o) => ({ ...o, file: e.target.files?.[0] ?? null, msg: '', error: '' }))} className="block w-full text-xs text-gray-700" />
        <input type="password" autoComplete="off" placeholder="Kata sandi berkas ini" value={open.pass} onChange={(e) => setOpen((o) => ({ ...o, pass: e.target.value }))} aria-label="Kata sandi untuk membuka arsip"
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs bg-white text-gray-900" />
        <InlineAlert message={open.error} onDismiss={() => setOpen((o) => ({ ...o, error: '' }))} />
        <Button variant="secondary" onClick={openArchive} disabled={!open.file || !open.pass || open.busy} loading={open.busy}>Buka Arsip</Button>
        {open.msg && <p role="status" aria-live="polite" className="text-[11px] font-bold text-emerald-700">{open.msg}</p>}
      </div>

      <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 space-y-2 text-xs text-gray-600">
        <p className="text-sm font-extrabold text-gray-900">Batas dan pemulihan</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>Satu backup per workspace tiap 5 menit. Data sangat besar (di atas ±15.000 dokumen) ditolak; hubungi admin.</li>
          <li>Hindari mengubah data saat unduhan berjalan; backup dibaca per koleksi, bukan snapshot tunggal.</li>
          <li>Memulihkan data: lihat panduan <b>docs/BACKUP-EKSPOR.md</b> (skrip <code>restore-export.mjs</code> memverifikasi arsip, lalu memulihkan ke lingkungan uji). Uji pemulihan secara berkala; backup yang belum pernah dipulihkan belum terbukti.</li>
        </ul>
      </div>
    </div>
  );
}
