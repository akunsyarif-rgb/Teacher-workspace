import { createClient } from '@supabase/supabase-js';
import { auth } from '@/src/config/firebase';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  {
    accessToken: async () => (await auth.currentUser?.getIdToken(false)) ?? null,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);
