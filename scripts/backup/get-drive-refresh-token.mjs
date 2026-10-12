#!/usr/bin/env node
// SEKALI SAJA, dijalankan PEMILIK di komputernya sendiri (bukan di CI): mengambil refresh token Drive untuk backup.
//   DRIVE_CLIENT_ID=... DRIVE_CLIENT_SECRET=... node scripts/backup/get-drive-refresh-token.mjs
// Alur loopback + PKCE (klien OAuth jenis "Desktop app"). Scope hanya drive.file. Token dicetak ke terminal Anda sendiri;
// simpan SEBAGAI GitHub Secret DRIVE_REFRESH_TOKEN, jangan ditempel ke chat/commit.
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

const { DRIVE_CLIENT_ID: id, DRIVE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) { console.error('Isi DRIVE_CLIENT_ID dan DRIVE_CLIENT_SECRET.'); process.exit(1); }
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname !== '/cb') { res.writeHead(404); return res.end(); }
  if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) { res.writeHead(400); res.end('state/kode tidak valid'); return; }
  const redirect = `http://127.0.0.1:${server.address().port}/cb`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: u.searchParams.get('code'), client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const j = await r.json();
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  if (!j.refresh_token) { res.end('Gagal: tidak ada refresh token (cabut akses lama di myaccount.google.com/permissions lalu ulangi).'); console.error('Tidak ada refresh_token pada respons.'); }
  else { res.end('Selesai. Kembali ke terminal.'); console.log(`\nDRIVE_REFRESH_TOKEN=${j.refresh_token}\n`); }
  server.close();
});
server.listen(0, '127.0.0.1', () => {
  const redirect = `http://127.0.0.1:${server.address().port}/cb`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state })}`;
  console.log(`Buka URL ini di browser, setujui akses (hanya berkas yang dibuat aplikasi ini):\n\n${url}\n`);
});
