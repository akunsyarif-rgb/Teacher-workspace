-- Run once in Supabase SQL Editor as project owner.
-- The Storage schema is managed by Supabase; this policy file is intentionally
-- kept separate from public-schema migrations because storage.objects ownership
-- is controlled by the platform.

create policy "submission_storage_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'submission-attachments'
  and (
    (
      (storage.foldername(name))[1] = 'submissions'
      and (select private.is_teacher_workspace((storage.foldername(name))[2]))
    )
    or
    (
      (storage.foldername(name))[1] = 'submissions'
      and (storage.foldername(name))[4] = (select auth.uid())::text
    )
    or
    (
      (storage.foldername(name))[1] = 'assignment-materials'
      and (select private.is_teacher_workspace((storage.foldername(name))[2]))
    )
  )
);

create policy "submission_storage_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'submission-attachments'
  and (
    (
      (storage.foldername(name))[1] = 'submissions'
      and (storage.foldername(name))[4] = (select auth.uid())::text
    )
    or
    (
      (storage.foldername(name))[1] = 'assignment-materials'
      and (select private.is_teacher_workspace((storage.foldername(name))[2]))
    )
  )
);

create policy "submission_storage_update"
on storage.objects for update to authenticated
using (bucket_id = 'submission-attachments' and owner_id = (select auth.uid())::text)
with check (bucket_id = 'submission-attachments' and owner_id = (select auth.uid())::text);

create policy "submission_storage_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'submission-attachments' and owner_id = (select auth.uid())::text);
