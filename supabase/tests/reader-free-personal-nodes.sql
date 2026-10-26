-- Real RPC, revision and RLS checks. Fixtures roll back; no reader rows are changed.
begin;
do $$
declare
  owner uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  book text := 'qa-04-' || gen_random_uuid()::text;
  free jsonb := '{"id":"free-04","title":"同名","markdown":"自由节点","page":null,"region":null,"chapterId":"chapter-2","sectionId":null}';
  boxed jsonb := '{"id":"boxed-04","title":"同名","markdown":"框选节点","page":32,"region":{"x":0.1,"y":0.2,"width":0.3,"height":0.1}}';
  payload jsonb; saved jsonb; reread jsonb; invalid jsonb; rejected boolean;
begin
  insert into auth.users(id, aud, role, email, created_at, updated_at)
    values (owner, 'authenticated', 'authenticated', owner::text || '@example.invalid', now(), now()),
      (other, 'authenticated', 'authenticated', other::text || '@example.invalid', now(), now());
  insert into public.reader_books(book_id, revision, content) values (book, 'qa-04', '{"pageCount":202}');
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  payload := jsonb_build_object('supplements', jsonb_build_array(free, boxed), 'notes', '{}'::jsonb);
  saved := public.reader_save_personal(book, owner, 0, payload);
  reread := public.reader_personal_snapshot(book, owner);
  assert reread = saved and saved->'content' = payload, 'free and boxed same-name nodes must round trip unchanged';
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    free - 'page', free - 'region', jsonb_set(free, '{page}', '8'),
    jsonb_set(boxed, '{region}', 'null'), jsonb_set(boxed, '{page}', '203'),
    jsonb_set(boxed, '{region,width}', '1'), jsonb_set(free, '{chapterId}', '3'),
    jsonb_set(free, '{sectionId}', '""'))) loop
    rejected := false;
    begin perform public.reader_save_personal(book, owner, 1, jsonb_set(payload, '{supplements,0}', invalid));
    exception when check_violation then rejected := true; end;
    assert rejected, 'partial locations, invalid boxes and invalid chapter shapes must fail';
    assert public.reader_personal_snapshot(book, owner) = saved, 'failed validation must keep the exact snapshot';
  end loop;
  payload := jsonb_set(payload, '{supplements,0,chapterId}', 'null');
  payload := jsonb_set(payload, '{supplements,0,title}', '"改名"');
  saved := public.reader_save_personal(book, owner, 1, payload);
  assert saved->'content'->'supplements'->0->>'id' = free->>'id', 'rename/unassign must keep the identity';
  rejected := false;
  begin perform public.reader_save_personal(book, owner, 1, jsonb_set(payload, '{notes,x}', '"stale"'));
  exception when sqlstate 'PT409' then rejected := true; end;
  assert rejected, 'revision conflicts must remain protected';
  perform set_config('request.jwt.claim.sub', other::text, true);
  assert not exists (select 1 from public.reader_personal where owner_id = owner), 'free nodes stay private to their owner';
  rejected := false;
  begin perform public.reader_personal_snapshot(book, owner); exception when insufficient_privilege then rejected := true; end;
  assert rejected, 'RPC owner checks must remain protected';
  set local role postgres;
end;
$$;
rollback;
select 'free/boxed round trip, atomic null pair, metadata shape, failed save preservation, rename, unassign, revision and account isolation passed' as result;
