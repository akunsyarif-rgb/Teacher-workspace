// Klien Google Drive minimal untuk arsip backup. Scope WAJIB `drive.file` (hanya berkas yang dibuat aplikasi ini; tidak bisa
// membaca/menghapus berkas Drive lain). Tanpa dependensi: fetch + REST v3. URL dapat diganti untuk tes dengan server palsu.
import { createHash } from 'node:crypto';

export const DEFAULT_ENDPOINTS = {
  token: 'https://oauth2.googleapis.com/token',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
};
const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const BACKUP_PREFIX = 'twbackup-';

class DriveError extends Error {
  constructor(step, status) {
    super(`Drive ${step} gagal (HTTP ${status})`); // tanpa isi respons: bisa memuat token/ID
    this.name = 'DriveError';
    this.status = status;
  }
}

export async function getAccessToken({ clientId, clientSecret, refreshToken }, { fetchImpl = fetch, endpoints = DEFAULT_ENDPOINTS } = {}) {
  const res = await fetchImpl(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  if (!res.ok) {
    // invalid_grant = refresh token dicabut/kedaluwarsa (mis. consent screen masih mode Testing → 7 hari). Kode saja, bukan isi.
    let code = '';
    try { code = String((await res.json()).error ?? ''); } catch { /* bukan JSON */ }
    throw new Error(`Token Drive ditolak (HTTP ${res.status}${code ? `, ${code.replace(/[^a-z_]/gi, '')}` : ''}).`);
  }
  const { access_token: t } = await res.json();
  if (!t) throw new Error('Respons token Drive tidak berisi access_token.');
  return t;
}

export function driveClient(accessToken, { fetchImpl = fetch, endpoints = DEFAULT_ENDPOINTS } = {}) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const q = (s) => encodeURIComponent(s);

  async function ensureFolder(name) {
    const found = await fetchImpl(`${endpoints.api}/files?q=${q(`name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and trashed=false`)}&fields=files(id)&spaces=drive`, { headers: auth });
    if (!found.ok) throw new DriveError('cari folder', found.status);
    const f = (await found.json()).files?.[0];
    if (f) return f.id;
    const made = await fetchImpl(`${endpoints.api}/files?fields=id`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME }) });
    if (!made.ok) throw new DriveError('buat folder', made.status);
    return (await made.json()).id;
  }

  /** Unggah resumable lalu verifikasi ukuran + MD5 sisi Drive terhadap berkas lokal. Mengembalikan metadata terverifikasi. */
  async function uploadVerified(folderId, filename, buf) {
    const start = await fetchImpl(`${endpoints.upload}/files?uploadType=resumable&fields=id,size,md5Checksum`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(buf.length) },
      body: JSON.stringify({ name: filename, parents: [folderId] }),
    });
    const loc = start.headers.get('location');
    if (!start.ok || !loc) throw new DriveError('mulai unggah', start.status);
    const put = await fetchImpl(loc, { method: 'PUT', headers: { 'Content-Length': String(buf.length), 'Content-Type': 'application/octet-stream' }, body: buf });
    if (!put.ok) throw new DriveError('unggah', put.status);
    const meta = await put.json();
    const md5 = createHash('md5').update(buf).digest('hex');
    if (Number(meta.size) !== buf.length || meta.md5Checksum !== md5) throw new Error('Verifikasi unggahan gagal: ukuran/MD5 di Drive tidak sama dengan berkas lokal.');
    return { id: meta.id, size: buf.length, md5 };
  }

  async function listBackups(folderId) {
    const out = [];
    let pageToken = '';
    do {
      const res = await fetchImpl(`${endpoints.api}/files?q=${q(`'${folderId}' in parents and trashed=false and name contains '${BACKUP_PREFIX}'`)}&fields=nextPageToken,files(id,name,size)&pageSize=200${pageToken ? `&pageToken=${q(pageToken)}` : ''}`, { headers: auth });
      if (!res.ok) throw new DriveError('daftar backup', res.status);
      const j = await res.json();
      out.push(...(j.files ?? []));
      pageToken = j.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  async function remove(fileId) {
    const res = await fetchImpl(`${endpoints.api}/files/${fileId}`, { method: 'DELETE', headers: auth });
    if (!res.ok && res.status !== 404) throw new DriveError('hapus', res.status);
  }

  return { ensureFolder, uploadVerified, listBackups, remove };
}

// Nama berkas memuat waktu UTC: twbackup-YYYYMMDDTHHMMSSZ.twb
export const backupFilename = (d) => `${BACKUP_PREFIX}${d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}.twb`;
const parseName = (name) => {
  const m = name.match(/^twbackup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.twb$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
};

/**
 * Retensi: simpan N terbaru (harian), + yang tertua dari tiap minggu ISO (W minggu), + yang tertua dari tiap bulan (M bulan).
 * Nama yang tidak dikenal TIDAK pernah dihapus. Mengembalikan berkas yang boleh dihapus.
 */
export function selectForDeletion(files, { daily = 14, weekly = 8, monthly = 6 } = {}) {
  const known = files.map((f) => ({ f, t: parseName(f.name) })).filter((x) => x.t).sort((a, b) => b.t - a.t);
  const keep = new Set(known.slice(0, daily).map((x) => x.f.id));
  const firstOf = (keyFn, limit) => {
    const seen = new Map();
    for (const x of [...known].reverse()) { const k = keyFn(x.t); if (!seen.has(k)) seen.set(k, x.f.id); }
    [...seen.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, limit).forEach(([, id]) => keep.add(id));
  };
  const weekKey = (t) => { const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };
  firstOf(weekKey, weekly);
  firstOf((t) => t.toISOString().slice(0, 7), monthly);
  return known.filter((x) => !keep.has(x.f.id)).map((x) => x.f);
}
