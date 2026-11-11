-- Penegakan batas unggah lampiran di level BUCKET (byte sebenarnya), bukan
-- hanya di route penandatangan. Tiket upload bertanda tangan dari
-- /api/submission-attachments/upload dipakai client langsung ke Supabase
-- Storage; tanpa batas di bucket, klien yang dimodifikasi bisa mengunggah
-- berkas apa pun / sebesar apa pun dengan tiket yang sah. Supabase menolak
-- upload di luar file_size_limit dan allowed_mime_types.
--
-- Sama dengan lib/utils/uploadRules.ts (MAX_FILE_BYTES, ALLOWED_UPLOAD_TYPES).
-- Bucket privat (public = false) ditegaskan ulang.
-- Dibungkus pengecekan: skema `storage` hanya ada di Supabase. Pada Postgres biasa (uji
-- migrasi lokal / CI) migrasi ini tidak melakukan apa-apa alih-alih gagal.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
    set public = false,
        file_size_limit = 10485760,
        allowed_mime_types = array[
          'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
          'application/pdf', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ]
    where id = 'submission-attachments';
  end if;
end
$$;
