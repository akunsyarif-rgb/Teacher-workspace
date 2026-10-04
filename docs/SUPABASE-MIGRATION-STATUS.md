# Teacher Workspace — Supabase Migration Status

The feature branch `feat/supabase-migration-storage` moves production persistence from Firebase Firestore/Storage to Supabase Postgres/Storage while preserving Firebase Authentication through Supabase Firebase Third-Party Auth.

## Production requirements before cutover

1. Register the Firebase project under Supabase Authentication → Third-Party Auth → Firebase.
2. Ensure every Firebase user receives the custom JWT claim `role=authenticated`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel.
4. Set server-only `SUPABASE_SECRET_KEY` in Vercel.
5. Create/verify the private `submission-attachments` bucket and run `docs/SUPABASE-STORAGE-POLICIES.sql` as project owner.
6. Migrate existing Firestore data before production cutover. Do not point the live app at the new backend while the Supabase tables are still empty.
7. Run a teacher/student smoke test against production after the data migration.

The Firebase emulator adapter remains available only when `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`, so the existing regression suite can continue to test the legacy rules while the production adapter targets Supabase.
