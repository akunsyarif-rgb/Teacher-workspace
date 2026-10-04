import type { User } from 'firebase/auth';

export async function syncSupabaseIdentity(user: User): Promise<void> {
  const idToken = await user.getIdToken(false);
  const response = await fetch('/api/auth/sync-claims', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'Gagal menyinkronkan identitas Supabase.');
  }

  const result = (await response.json()) as { refreshRequired?: boolean };
  if (result.refreshRequired) {
    await user.getIdToken(true);
  }
}
