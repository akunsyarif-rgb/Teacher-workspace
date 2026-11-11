-- Membuka kembali batas bucket (hanya bila migrasi pengerasan menimbulkan masalah).
-- Tidak melakukan apa-apa di luar Supabase (skema `storage` tidak ada).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'submission-attachments';
  end if;
end
$$;
