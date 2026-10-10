-- RPC transaksional untuk padanan Firestore writeBatch (set-merge / delete, atomik, maks. 500 operasi).
-- SECURITY INVOKER: RLS tiap tabel tetap berlaku untuk pemanggil (tidak ada eskalasi hak). Hanya tabel data
-- aplikasi yang diizinkan (bukan workspaces/teacher_profiles/student_profiles/payments/workspace_invites).
--   p_ops = [{"op":"set","table":"students","row":{"id":"...","workspace_id":"...","name":"..."}},
--            {"op":"delete","table":"students","id":"..."}]
-- set = perbarui bila (id, workspace_id) ada: HANYA kolom yang dikirim (kecuali id/workspace_id/created_at), `metadata` digabung (||)
-- — sama seperti setDoc(merge:true); bila belum ada: insert. id milik workspace lain → gagal keras (23505), tidak menimpa.
create or replace function public.batch_write(p_ops jsonb) returns integer
language plpgsql security invoker set search_path to '' as $function$
declare
  allowed constant text[] := array['academic_years','announcements','assignments','attendances','class_fund_transactions',
    'class_inventory','grade_columns','grades','journals','schedules','session_skip_reasons','student_achievements',
    'student_login_codes','student_notes','students','submissions'];
  op jsonb; t text; k text; cols text; sets text; updated bigint; n integer := 0;
begin
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then raise exception 'p_ops must be a json array' using errcode = '22023'; end if;
  if jsonb_array_length(p_ops) > 500 then raise exception 'too many operations (max 500)' using errcode = '22023'; end if;
  for op in select * from jsonb_array_elements(p_ops) loop
    t := op ->> 'table';
    if t is null or not (t = any(allowed)) then raise exception 'table not allowed: %', coalesce(t, '<null>') using errcode = '22023'; end if;
    if op ->> 'op' = 'delete' then
      if coalesce(op ->> 'id', '') = '' then raise exception 'delete requires id' using errcode = '22023'; end if;
      execute format('delete from public.%I where id = $1', t) using op ->> 'id';
    elsif op ->> 'op' = 'set' then
      if jsonb_typeof(op -> 'row') <> 'object' or coalesce(op -> 'row' ->> 'id', '') = '' or coalesce(op -> 'row' ->> 'workspace_id', '') = '' then
        raise exception 'set requires row with id and workspace_id' using errcode = '22023';
      end if;
      for k in select jsonb_object_keys(op -> 'row') loop
        if not exists (select 1 from pg_attribute a where a.attrelid = format('public.%I', t)::regclass and a.attname = k and a.attnum > 0 and not a.attisdropped) then
          raise exception 'unknown column %.%', t, k using errcode = '22023';
        end if;
      end loop;
      select string_agg(format('%I', c), ',' order by c) into cols from jsonb_object_keys(op -> 'row') c;
      select string_agg(case when c = 'metadata' then format('metadata = x.metadata || r.metadata')
                             else format('%I = r.%I', c, c) end, ',' order by c)
        into sets from jsonb_object_keys(op -> 'row') c where c not in ('id', 'workspace_id', 'created_at');
      -- 1) perbarui bila ada (hanya kolom yang dikirim; workspace_id harus sama), 2) kalau tidak ada: insert (default kolom lain berlaku).
      --    Baris milik workspace lain yang id-nya sama → insert bentrok PK (23505): gagal keras, tidak menimpa diam-diam.
      if sets is not null then
        execute format('update public.%1$I x set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where x.id = r.id and x.workspace_id = r.workspace_id',
                       t, sets) using op -> 'row';
        get diagnostics updated = row_count;
      else
        execute format('select count(*) from public.%I x where x.id = $1 ->> ''id'' and x.workspace_id = $1 ->> ''workspace_id''', t) into updated using op -> 'row';
      end if;
      if updated = 0 then
        execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)', t, cols) using op -> 'row';
      end if;
    else
      raise exception 'unknown op: %', coalesce(op ->> 'op', '<null>') using errcode = '22023';
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$function$;
revoke all on function public.batch_write(jsonb) from public, anon;
grant execute on function public.batch_write(jsonb) to authenticated;
