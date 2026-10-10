-- Rollback 20261010000000_ulangan_harian.sql. MENGHAPUS SEMUA DATA ULANGAN HARIAN. Jalankan hanya dengan persetujuan.
drop function if exists public.ulh_report_integrity_event(text, uuid, uuid, text, timestamptz, integer, jsonb);
drop function if exists public.ulh_submit_attempt(text, uuid);
drop function if exists public.ulh_save_answer(text, uuid, uuid, uuid, bigint);
drop function if exists public.ulh_get_attempt(text, uuid);
drop function if exists public.ulh_start_attempt(text, text, text, text, uuid);
drop function if exists public.ulh_list_student_exams(text, text, text);
drop function if exists public.ulh_attempt_events(text, text, boolean, uuid);
drop function if exists public.ulh_exam_results(text, text, boolean, uuid);
drop function if exists public.ulh_delete_exam(text, text, boolean, uuid);
drop function if exists public.ulh_close_exam(text, text, boolean, uuid);
drop function if exists public.ulh_publish_exam(text, text, boolean, uuid);
drop function if exists public.ulh_list_exams(text, text, boolean);
drop function if exists public.ulh_get_exam(text, text, boolean, uuid);
drop function if exists public.ulh_save_exam(text, text, boolean, jsonb);
drop table if exists public.ulh_integrity_events, public.ulh_answers, public.ulh_attempts, public.ulh_question_keys,
  public.ulh_options, public.ulh_questions, public.ulh_exam_classes, public.ulh_exams cascade;
drop function if exists private.ulh_need(text, text);
drop function if exists private.ulh_attempt_summary(uuid);
drop function if exists private.ulh_finalize(uuid, text);
drop function if exists private.ulh_touch();
