// Pengodean nilai Firestore ↔ JSON bertipe (tipe Timestamp/GeoPoint/Reference/Bytes tidak hilang). Hanya server/skrip (Admin SDK).
import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';

export function encodeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : { __t: 'num', v: String(v) };
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', path: v.path };
  if (v instanceof Uint8Array) return { __t: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = encodeValue(x);
    return '__t' in out ? { __t: 'map', v: out } : out; // peta yang kebetulan punya kunci "__t" dibungkus agar tidak ambigu
  }
  throw new Error(`Tipe nilai tidak didukung: ${typeof v}`);
}

export function decodeValue(v, db) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, db));
  switch (v.__t) {
    case 'num': return Number(v.v);
    case 'ts': return new Timestamp(v.s, v.n);
    case 'geo': return new GeoPoint(v.lat, v.lng);
    case 'ref': return db.doc(v.path);
    case 'bytes': return Buffer.from(v.b64, 'base64');
    case 'map': return Object.fromEntries(Object.entries(v.v).map(([k, x]) => [k, decodeValue(x, db)]));
    default: return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeValue(x, db)]));
  }
}
