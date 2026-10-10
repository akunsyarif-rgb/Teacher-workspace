-- Rollback 20261010000000_ulangan_harian.sql. MENGHAPUS SEMUA DATA ULANGAN HARIAN. Jalankan hanya dengan persetujuan.
drop function if exists public.ulh_rate_hit(text, text, integer, integer);
drop function if exists public.ulh_report_integrity_event(uuid, uuid, text, timestamptz, integer, jsonb);
drop function if exists public.ulh_submit_attempt(uuid);
drop function if exists public.ulh_save_answer(uuid, uuid, uuid, bigint);
drop function if exists public.ulh_get_attempt(uuid);
drop function if exists public.ulh_start_attempt(uuid);
drop function if exists public.ulh_list_my_exams();
drop function if exists public.ulh_attempt_events(uuid);
drop function if exists public.ulh_exam_monitor(uuid);
drop function if exists public.ulh_list_exams();
drop function if exists public.ulh_delete_exam(uuid);
drop function if exists public.ulh_close_exam(uuid);
drop function if exists public.ulh_publish_exam(uuid);
drop function if exists public.ulh_save_exam(jsonb);
drop function if exists public.ulh_get_package(uuid);
drop function if exists public.ulh_list_packages();
drop function if exists public.ulh_delete_package(uuid);
drop function if exists public.ulh_save_package(jsonb);
drop table if exists public.ulh_audit_log, public.ulh_integrity_events, public.ulh_answers, public.ulh_attempt_questions,
  public.ulh_attempts, public.ulh_exam_classes, public.ulh_exams, public.ulh_question_keys, public.ulh_options,
  public.ulh_questions, public.ulh_packages, public.ulh_members, public.ulh_roster, public.ulh_rate_buckets cascade;
drop function if exists private.ulh_attempt_summary(uuid);
drop function if exists private.ulh_members_touch();
drop function if exists private.ulh_finalize(uuid, text);
drop function if exists private.ulh_audit(text, text, text, text, text, jsonb);
drop function if exists private.ulh_manages_attempt(uuid);
drop function if exists private.ulh_is_admin_of(text);
drop function if exists private.ulh_manages_exam(uuid);
drop function if exists private.ulh_manages_package(uuid);
drop function if exists private.ulh_student_ctx();
drop function if exists private.ulh_teacher_ctx();
