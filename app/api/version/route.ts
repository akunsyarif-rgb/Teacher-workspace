import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/config/appVersion';

// Versi build yang sedang MELAYANI permintaan (hash commit di Vercel). Klien membandingkannya dengan versi yang
// tertanam di bundel JS-nya sendiri: beda = perangkat masih memakai bundel lama (mis. setelah aturan Firestore diperketat)
// dan perlu dimuat ulang. Publik dan tanpa data sensitif; tidak boleh di-cache.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json(
    { version: APP_VERSION },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
