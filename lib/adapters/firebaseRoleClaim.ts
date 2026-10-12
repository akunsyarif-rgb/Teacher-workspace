import { SupabaseAdapterError } from './supabaseAdapter';
import { hasAuthenticatedRole } from '../utils/jwtClaims';

// Supabase Third-Party Auth (Firebase) hanya menerima token yang punya claim `role: "authenticated"`, sedangkan token Firebase
// biasa tidak punya. Opsi paling sederhana TANPA Identity Platform dan TANPA migrasi Firebase Auth: server memasang claim itu
// dengan Admin SDK (setCustomUserClaims) lewat POST /api/auth/supabase-claim, lalu klien memperbarui token (getIdToken(true)).
// Berlaku sama untuk guru dan siswa anonim. Claim dipasang sekali per akun; token berikutnya membawanya otomatis.
export interface RoleClaimUser {
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export function createSupabaseTokenProvider(deps: {
  getUser: () => RoleClaimUser | null;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}) {
  const doFetch = deps.fetchImpl ?? fetch;
  const endpoint = deps.endpoint ?? '/api/auth/supabase-claim';
  let pending: Promise<string> | null = null; // permintaan klaim bersamaan digabung

  async function installClaim(user: RoleClaimUser, token: string) {
    const res = await doFetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      let msg = '';
      try {
        const j = (await res.json()) as { error?: string; hint?: string; deployment?: { commit?: string | null; environment?: string; branch?: string | null } };
        msg = [j.error, j.hint, j.deployment ? `[deployment: ${j.deployment.environment ?? '?'} ${j.deployment.branch ?? ''} ${j.deployment.commit ?? ''}]` : ''].filter(Boolean).join(' ');
      } catch { /* bukan JSON */ }
      throw new SupabaseAdapterError('auth', `Claim role Supabase gagal dipasang (HTTP ${res.status}). ${msg}`.trim(), res.status);
    }
    const refreshed = await user.getIdToken(true); // claim baru hanya muncul di token yang diperbarui
    if (!hasAuthenticatedRole(refreshed)) {
      throw new SupabaseAdapterError('auth', 'Claim role sudah dipasang tetapi belum muncul di token. Coba lagi.');
    }
    return refreshed;
  }

  return async function getToken(forceRefresh = false): Promise<string | null> {
    const user = deps.getUser();
    if (!user) return null;
    const token = await user.getIdToken(forceRefresh);
    if (hasAuthenticatedRole(token)) return token;
    pending ??= installClaim(user, token).finally(() => { pending = null; });
    return pending;
  };
}
