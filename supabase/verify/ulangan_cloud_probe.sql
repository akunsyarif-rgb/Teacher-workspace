-- Probe keamanan/alur Ulangan Harian di DB nyata. SELURUH perubahan dibatalkan (raise exception di akhir); hasil dibaca dari pesan galat PROBE_RESULT.
-- Jalankan HANYA pada project Workflow. Jangan di SmadaExam atau Production. Dijalankan 2026-10-11: 36 pemeriksaan sesuai harapan.
create or replace function pg_temp.t(q text) returns text language plpgsql as $f$
declare r text;
begin execute q into r; return 'ok:' || coalesce(left(r, 90), '<null>');
exception when others then return 'err:' || sqlstate || ':' || left(sqlerrm, 60); end $f$;
do $$
declare
  res text[] := '{}'; ex uuid; exid text; att text; att2 text; qs jsonb; q1 text; q2 text; o1 text; o2 text; ga text; n int; sc1 text; sc2 text;
  body text := '{"title":"PROBE","subject":"X","duration_minutes":30,"class_names":["9X"],"shuffle":true,"show_result":true,"opens_at":"2000-01-01T00:00:00Z","closes_at":"2999-01-01T00:00:00Z","questions":[{"body":"Q1","options":["a","b","c","d"],"correct_index":1},{"body":"Q2","options":["a","b","c","d"],"correct_index":0}]}';
begin
  exid := pg_temp.t(format($q$select (public.ulh_save_exam('zzA','tA',false,%L::jsonb))::text$q$, body)); exid := substr(exid, 4);
  res := res || ('01 simpan ulangan: ' || (exid ~ '^[0-9a-f-]{36}$')::text);
  res := res || ('02 guru lain (ws sama) get_exam: ' || pg_temp.t(format($q$select public.ulh_get_exam('zzA','tX',false,%L)$q$, exid)));
  res := res || ('03 guru ws lain get_exam: ' || pg_temp.t(format($q$select public.ulh_get_exam('zzB','tA',false,%L)$q$, exid)));
  res := res || ('04 publish oleh guru lain: ' || pg_temp.t(format($q$select public.ulh_publish_exam('zzA','tX',false,%L)$q$, exid)));
  res := res || ('05 publish oleh pemilik: ' || pg_temp.t(format($q$select public.ulh_publish_exam('zzA','tA',false,%L)$q$, exid)));
  res := res || ('06 ubah ulangan terbit: ' || pg_temp.t(format($q$select public.ulh_save_exam('zzA','tA',false,%L::jsonb || jsonb_build_object('id',%L))$q$, body, exid)));
  res := res || ('07 daftar siswa kelas benar (jumlah): ' || pg_temp.t($q$select jsonb_array_length(public.ulh_list_student_exams('zzA','s1','9X')->'exams')$q$));
  res := res || ('08 daftar siswa kelas lain (jumlah): ' || pg_temp.t($q$select jsonb_array_length(public.ulh_list_student_exams('zzA','s1','9Y')->'exams')$q$));
  res := res || ('09 daftar siswa ws lain (jumlah): ' || pg_temp.t($q$select jsonb_array_length(public.ulh_list_student_exams('zzB','s1','9X')->'exams')$q$));
  res := res || ('10 mulai: kelas salah: ' || pg_temp.t(format($q$select public.ulh_start_attempt('zzA','uS9','s9','9Y',%L)$q$, exid)));
  res := res || ('11 mulai: ws salah: ' || pg_temp.t(format($q$select public.ulh_start_attempt('zzB','uS9','s9','9X',%L)$q$, exid)));
  att := pg_temp.t(format($q$select (public.ulh_start_attempt('zzA','uS1','s1','9X',%L))->>'id'$q$, exid)); att := substr(att, 4);
  res := res || ('12 mulai: benar: ' || (att ~ '^[0-9a-f-]{36}$')::text);
  ga := public.ulh_get_attempt('uS1', att::uuid)::text;
  res := res || ('13 payload siswa memuat kata correct/key/is_right: ' || (ga ~* '(correct|is_right|"key")')::text);
  res := res || ('14 get_attempt uid lain: ' || pg_temp.t(format($q$select public.ulh_get_attempt('uZZ',%L)$q$, att)));
  qs := public.ulh_get_attempt('uS1', att::uuid)->'questions';
  q1 := qs->0->>'id'; q2 := qs->1->>'id'; o1 := qs->0->'options'->0->>'id'; o2 := qs->1->'options'->0->>'id';
  res := res || ('15 save_answer uid lain: ' || pg_temp.t(format($q$select public.ulh_save_answer('uZZ',%L,%L,%L,5)$q$, att, q1, o1)));
  res := res || ('16 save_answer opsi milik soal lain: ' || pg_temp.t(format($q$select public.ulh_save_answer('uS1',%L,%L,%L,6)$q$, att, q1, o2)));
  res := res || ('17 save_answer sah seq=10: ' || pg_temp.t(format($q$select public.ulh_save_answer('uS1',%L,%L,%L,10)$q$, att, q1, o1)));
  perform public.ulh_save_answer('uS1', att::uuid, q1::uuid, (qs->0->'options'->1->>'id')::uuid, 3); -- seq lama (3<10) harus diabaikan
  select option_id::text into ga from public.ulh_answers where attempt_id = att::uuid and question_id = q1::uuid;
  res := res || ('18 seq lama tidak menimpa (opsi tetap pilihan seq=10): ' || (ga = o1)::text);
  res := res || ('19 mulai ulang (resume) id sama: ' || (pg_temp.t(format($q$select (public.ulh_start_attempt('zzA','uS1','s1','9X',%L))->>'id'$q$, exid)) = 'ok:' || att)::text);
  sc1 := pg_temp.t(format($q$select (public.ulh_submit_attempt('uS1',%L))::text$q$, att));
  sc2 := pg_temp.t(format($q$select (public.ulh_submit_attempt('uS1',%L))::text$q$, att));
  res := res || ('20 kumpul ganda hasil sama: ' || (sc1 = sc2)::text || ' | ' || sc1);
  select count(*) into n from public.ulh_attempts where exam_id = exid::uuid; res := res || ('21 jumlah pengerjaan setelah kumpul ganda: ' || n);
  res := res || ('22 save_answer setelah kumpul: ' || pg_temp.t(format($q$select public.ulh_save_answer('uS1',%L,%L,%L,99)$q$, att, q1, o1)));
  res := res || ('23 submit uid lain: ' || pg_temp.t(format($q$select public.ulh_submit_attempt('uZZ',%L)$q$, att)));
  res := res || ('24 hasil guru pemilik (baris): ' || pg_temp.t(format($q$select jsonb_array_length(public.ulh_exam_results('zzA','tA',false,%L)->'attempts')$q$, exid)));
  res := res || ('25 hasil guru lain: ' || pg_temp.t(format($q$select public.ulh_exam_results('zzA','tX',false,%L)$q$, exid)));
  -- waktu habis: ulangan 2, majukan jam dengan menggeser expires_at ke masa lalu
  ex := public.ulh_save_exam('zzA','tA',false, body::jsonb || '{"title":"PROBE2"}'::jsonb);
  perform public.ulh_publish_exam('zzA','tA',false,ex);
  att2 := (public.ulh_start_attempt('zzA','uS2','s2','9X',ex))->>'id';
  update public.ulh_attempts set started_at = clock_timestamp() - interval '31 minutes', expires_at = clock_timestamp() - interval '1 minute' where id = att2::uuid;
  qs := public.ulh_get_attempt('uS2', att2::uuid)->'questions';
  res := res || ('26 save_answer setelah waktu habis: ' || pg_temp.t(format($q$select public.ulh_save_answer('uS2',%L,%L,%L,1)$q$, att2, qs->0->>'id', qs->0->'options'->0->>'id')));
  perform public.ulh_submit_attempt('uS2', att2::uuid);
  res := res || ('27 submit setelah waktu habis -> status di tabel: ' || (select status from public.ulh_attempts where id = att2::uuid));
  -- ditutup
  perform public.ulh_close_exam('zzA','tA',false,ex);
  res := res || ('28 mulai ulangan yang ditutup: ' || pg_temp.t(format($q$select public.ulh_start_attempt('zzA','uS3','s3','9X',%L)$q$, ex::text)));
  -- integritas: 3000 ms tidak dihitung, 3100 ms dihitung
  ex := public.ulh_save_exam('zzA','tA',false, body::jsonb || '{"title":"PROBE3"}'::jsonb);
  perform public.ulh_publish_exam('zzA','tA',false,ex);
  att2 := (public.ulh_start_attempt('zzA','uS4','s4','9X',ex))->>'id';
  res := res || ('29 keluar 3000ms (tak dihitung): ' || pg_temp.t(format($q$select public.ulh_report_integrity_event('uS4',%L,gen_random_uuid(),'TAB_SWITCH',now(),3000,'{}')::text$q$, att2)));
  res := res || ('30 keluar 3100ms (dihitung): ' || pg_temp.t(format($q$select public.ulh_report_integrity_event('uS4',%L,gen_random_uuid(),'TAB_SWITCH',now(),3100,'{}')::text$q$, att2)));
  res := res || ('31 event uid lain: ' || pg_temp.t(format($q$select public.ulh_report_integrity_event('uZZ',%L,gen_random_uuid(),'TAB_SWITCH',now(),9000,'{}')::text$q$, att2)));
  -- hak peran database
  set local role authenticated;
  res := res || ('32 role authenticated panggil RPC: ' || pg_temp.t($q$select public.ulh_list_exams('zzA','tA',false)::text$q$));
  res := res || ('33 role authenticated baca tabel kunci: ' || pg_temp.t($q$select count(*)::text from public.ulh_question_keys$q$));
  set local role anon;
  res := res || ('34 role anon panggil RPC: ' || pg_temp.t($q$select public.ulh_list_exams('zzA','tA',false)::text$q$));
  res := res || ('35 role anon baca tabel ulangan: ' || pg_temp.t($q$select count(*)::text from public.ulh_exams$q$));
  reset role;
  res := res || ('36 service_role baca tabel kunci langsung: ' || (select (not has_table_privilege('service_role','public.ulh_question_keys','SELECT'))::text) || ' (true = ditolak)');
  raise exception E'PROBE_RESULT\n%', array_to_string(res, E'\n');
end $$;
