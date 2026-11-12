// Versi build, ditanam saat build lewat next.config.ts (env NEXT_PUBLIC_APP_VERSION): hash commit di Vercel/GitHub,
// atau penanda unik per build lokal. Nilai yang sama terbaca di bundel klien DAN di route server milik build itu.
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION ?? '';
