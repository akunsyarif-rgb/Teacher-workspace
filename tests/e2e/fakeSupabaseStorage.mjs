/**
 * Supabase Storage PALSU untuk E2E — meniru hanya kontrak yang dipakai
 * aplikasi (signed upload: POST lalu PUT multipart; signed download: POST
 * lalu GET). Ini BUKAN bukti bahwa Supabase asli bekerja; ia hanya membuat
 * seluruh alur UI + route API bisa diuji tanpa secret key sungguhan.
 */
import http from 'node:http';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export function startFakeSupabaseStorage(port = 4590) {
  const uploads = [];
  const server = http.createServer((req, res) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const { pathname } = new URL(req.url, 'http://x');
      const json = (body, status = 200) => {
        res.writeHead(status, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      // Seperti Supabase asli: path di luar /storage/v1 = 404 "Invalid path".
      if (!pathname.startsWith('/storage/v1/')) return json({ message: 'Invalid path specified in request URL' }, 404);
      const rest = pathname.slice('/storage/v1'.length);
      if (req.method === 'POST' && rest.startsWith('/object/upload/sign/')) return json({ url: `${rest}?token=T1` });
      if (req.method === 'PUT' && rest.startsWith('/object/upload/sign/')) {
        uploads.push({ path: rest, bytes: Buffer.concat(chunks).length, contentType: req.headers['content-type'] });
        return json({ Key: rest });
      }
      if (req.method === 'POST' && rest.startsWith('/object/sign/')) return json({ signedURL: `${rest}?token=T2` });
      if (req.method === 'GET' && rest.startsWith('/object/sign/')) {
        res.writeHead(200, { ...cors, 'content-type': 'image/png' });
        return res.end(PNG);
      }
      return json({ message: 'not found' }, 404);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${port}`,
        uploads,
        close: () => new Promise((done) => server.close(done)),
      })
    );
  });
}
