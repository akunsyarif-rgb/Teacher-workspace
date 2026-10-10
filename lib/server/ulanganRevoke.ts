import { isClaimEnabled } from './claimFlag';
import { createIdentitySink, type ServiceRequest } from './ulanganIdentitySink';
import { serviceRequest } from './supabaseServer';

/** Cabut proyeksi identitas modul Ulangan Harian untuk satu uid (mis. guru dikeluarkan dari workspace). Best-effort: tidak pernah
 *  menggagalkan alur pemanggil — TTL 30 menit tetap menutup bila pencabutan gagal. Tidak berbuat apa-apa bila fitur sinkronisasi mati. */
export async function revokeUlanganMember(
  uid: string,
  deps: { enabled?: string | undefined; request?: ServiceRequest; log?: (m: string) => void } = {}
): Promise<boolean> {
  const enabled = 'enabled' in deps ? deps.enabled : process.env.ENABLE_ULANGAN_IDENTITY_SYNC;
  if (!uid || !isClaimEnabled(enabled)) return false;
  try {
    await createIdentitySink(deps.request ?? serviceRequest).remove('ulh_members', `user_id=eq.${encodeURIComponent(uid)}`);
    return true;
  } catch (e) {
    (deps.log ?? console.error)(`ulangan revoke gagal: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
