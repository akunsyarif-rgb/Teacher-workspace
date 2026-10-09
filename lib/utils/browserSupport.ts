/**
 * Apakah cache lokal Firestore berbasis IndexedDB (persistentLocalCache)
 * aman dipakai di browser ini.
 *
 * Di semua browser berbasis WebKit — Safari macOS, serta SEMUA browser di
 * iPhone/iPad (Chrome/Firefox iOS memakai WebKit juga) — penyiapan IndexedDB
 * oleh Firestore terukur menggantung belasan detik: pembacaan cache lokal
 * (tanpa jaringan) pun tidak kunjung selesai, sehingga layar "Memuat..."
 * macet di iPad guru. Di sana dipakai cache memori (bawaan Firestore).
 * Harganya: antrean tulis saat OFFLINE tidak bertahan setelah tab ditutup.
 *
 * Fungsi murni supaya bisa diuji tanpa browser.
 */
export function shouldUsePersistentCache(
  userAgent: string,
  platform: string = '',
  maxTouchPoints: number = 0
): boolean {
  const ua = userAgent || '';
  // iPadOS 13+ mengaku sebagai "Macintosh" — dibedakan lewat layar sentuh.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  // Safari desktop: "Safari" ada, tapi bukan Chrome/Chromium/Edge/Opera/Firefox/Android.
  const isDesktopSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android|Firefox|FxiOS/.test(ua);
  return !(isIOS || isDesktopSafari);
}
