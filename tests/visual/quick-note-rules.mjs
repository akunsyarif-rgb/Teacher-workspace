/**
 * Uji garis Catatan Cepat (.notebook-paper) di Chromium: posisi garis,
 * jarak antar garis, dan tidak ada glyph yang menembus garis untuk Enter
 * berulang, baris kosong, paste multi-baris, teks panjang, resize, dan skala
 * font 1x/1.25x/1.5x pada lebar mobile/iPad/desktop.
 *
 * Jalankan setelah `npm run build`:
 *   node tests/visual/quick-note-rules.mjs
 * Hanya memeriksa CSS hasil build; BUKAN pengganti uji Safari iPad.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'node:path';
const dir = '.next/static/chunks';
const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const cls = 'notebook-paper w-full min-h-[7.5rem] p-3 rounded-xl border text-base font-medium text-[#242923] outline-none resize-y';
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const scen = {
  repeatedEnter: '\n\n\n\nHxHxHx\n\nHxHx',
  blank: 'Hx\n\nHx\n\n\nHx',
  paste: Array.from({length:12},(_, i)=>`Hxg ${i+1}`).join('\n'),
  long: 'HxHx gjpq '.repeat(60),
  mixed: 'Hx\nHx\n' + 'Hxgy '.repeat(40) + '\n\nHx',
};
let fail = 0, n = 0;
for (const [vp, w] of [['mobile',390],['ipad-portrait',820],['desktop',1280]])
 for (const scale of [1, 1.25, 1.5]) {
  const p = await b.newPage({ viewport: { width: w, height: 1400 }, deviceScaleFactor: 1 });
  await p.setContent(`<style>${css}</style><body style="margin:20px"><div style="width:${Math.min(w-40,420)}px"><textarea id=t rows=3 class="${cls}"></textarea></div>`);
  await p.evaluate(s => document.documentElement.style.fontSize = s + 'px', 16*scale);
  for (const [name, text] of Object.entries(scen)) {
    await p.fill('#t', text);
    for (const growTo of [null, 520]) {
      await p.evaluate(h => { const t = document.getElementById('t'); t.style.height = h ? h + 'px' : ''; t.scrollTop = 0; }, growTo);
      const box = await (await p.$('#t')).boundingBox();
      const g = await p.evaluate(() => { const t = document.getElementById('t'), c = getComputedStyle(t); return { lh: parseFloat(c.lineHeight), pt: parseFloat(c.paddingTop), bt: parseFloat(c.borderTopWidth), sh: t.scrollHeight, ch: t.clientHeight }; });
      const png = await p.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 1300) } });
      const pg = await b.newPage();
      // decode PNG via canvas in a page
      const b64 = png.toString('base64');
      const res = await pg.evaluate(async ({ b64, g }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, img.width, img.height).data;
        const mid = Math.floor(img.width / 2);
        // per-row: count dark (glyph) px, and rule px (D9DED5) across the width
        const rows = [];
        for (let y = 0; y < img.height; y++) {
          let dark = 0, rule = 0;
          for (let xx = 14; xx < img.width - 14; xx++) {
            const i = (y * img.width + xx) * 4, r = d[i], gg = d[i+1], bb = d[i+2];
            if (r < 110 && gg < 110 && bb < 110) dark++;
            if (Math.abs(r-0xD9) < 6 && Math.abs(gg-0xDE) < 6 && Math.abs(bb-0xD5) < 6) rule++;
          }
          rows.push([dark, rule]);
        }
        return rows;
      }, { b64, g });
      await pg.close();
      const ruleRows = res.map((r,i)=>[r[1] > res.length*0+ (box.width*0.8), i]).filter(x=>x[0]).map(x=>x[1]);
      const lh = g.lh, origin = g.bt + g.pt;
      // expected rule row: origin + k*lh + lh - 1 (padding-box top = bt; content top = bt+pt)
      const firstRule = ruleRows[0];
      n++;
      const expect = Math.round(origin + lh - 1);
      let bad = [];
      if (Math.abs(firstRule - expect) > 1.5) bad.push(`first rule ${firstRule} vs ${expect}`);
      // spacing
      for (let i = 1; i < ruleRows.length; i++) { const dlt = ruleRows[i]-ruleRows[i-1]; if (Math.abs(dlt - lh) > 1.5) { bad.push(`gap ${dlt}`); break; } }
      // glyph overlap with rule rows: dark pixels on a rule row => text crosses line
      const crossing = ruleRows.filter(y => res[y][0] > 0 && res[y][1] === 0).length;
      const crossing2 = ruleRows.filter(y => res[y][0] > 2).length;
      if (crossing2) bad.push(`glyph crossing rule rows: ${crossing2}`);
      if (bad.length) { fail++; console.log('FAIL', vp, scale, name, growTo, bad.join('; '), 'rules', ruleRows.slice(0,4)); }
    }
  }
  await p.close();
 }
console.log(`${n} cases, ${fail} failures`);
process.exitCode = fail ? 1 : 0;
await b.close();
