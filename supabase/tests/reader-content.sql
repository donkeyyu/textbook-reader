-- Run through Supabase execute_sql. All fixtures and auth users roll back.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); source uuid := gen_random_uuid(); failed_source uuid := gen_random_uuid();
  node_source uuid := gen_random_uuid(); note_source uuid := gen_random_uuid(); identical_source uuid := gen_random_uuid();
  deleted_node_source uuid := gen_random_uuid(); deleted_note_source uuid := gen_random_uuid();
  book text := 'qa-02-' || gen_random_uuid()::text;
  legacy jsonb := '{"supplements":[{"id":"qa-node","title":"旧标题","markdown":"旧正文","page":8,"region":{"x":0.1,"y":0.2,"width":0.5,"height":0.1}}],"notes":{"default":"旧笔记"}}';
  node_only jsonb := jsonb_build_object('supplements', legacy->'supplements', 'notes', '{}'::jsonb);
  note_only jsonb := jsonb_build_object('supplements', '[]'::jsonb, 'notes', legacy->'notes');
  first jsonb; second jsonb; current_doc jsonb; result jsonb; blocked boolean; current_revision bigint;
  node_raw text := E' \n' || node_only::text || E'\n '; late_raw text; retry_raw text;
begin
  insert into auth.users(id, aud, role, email, created_at, updated_at)
    values (a, 'authenticated', 'authenticated', a::text || '@example.invalid', now(), now()),
           (b, 'authenticated', 'authenticated', b::text || '@example.invalid', now(), now());
  insert into public.reader_books(book_id, revision, content) values (book, 'before', '{"pageCount":202}');
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  result := public.reader_personal_snapshot(book, a);
  assert result->'content' = '{"supplements":[],"notes":{}}'::jsonb
    and (result->>'revision')::integer = 0 and result->'copies' = '[]'::jsonb,
    'a read before migration must return the empty snapshot';
  first := public.reader_migrate_legacy(book, a, source, legacy::text);
  assert first->'content' = legacy and (first->>'revision')::integer = 1, 'first migration must preserve exact content';
  assert jsonb_array_length(first->'copies') = 1
    and first->'copies'->0->>'source_id' = source::text
    and first->'copies'->0->>'raw' = legacy::text
    and first->'copies'->0->>'kind' = 'initial'
    and first->'copies'->0->'has_conflict' = 'false'::jsonb,
    'migration must immediately return the inserted recovery copy after a prior read';
  assert exists (select 1 from public.reader_legacy where source_id = source and kind = 'initial' and not has_conflict and raw = legacy::text), 'clean initial source must persist a false conflict flag and exact raw text';
  result := public.reader_migrate_legacy(book, a, source, legacy::text);
  assert result = first, 'repeated migration must be idempotent';
  current_doc := jsonb_set(jsonb_set(legacy, '{notes,default}', '"新库笔记"'), '{supplements,0,markdown}', '"新库正文"');
  second := public.reader_save_personal(book, a, 1, current_doc);
  assert second->'content' = current_doc and (second->>'revision')::integer = 2, 'save must commit exact revision';
  assert second->'copies' = first->'copies' and public.reader_personal_snapshot(book, a) = second,
    'save must immediately return the new document with its existing recovery copies';
  result := public.reader_save_personal(book, a, 1, current_doc);
  assert result = second, 'lost-response retry must not rewrite the document';

  result := public.reader_migrate_legacy(book, a, node_source, node_raw);
  assert result->'content' = current_doc, 'first source node collision must not replace newer cloud content';
  assert exists (select 1 from public.reader_legacy where source_id = node_source and kind = 'initial' and has_conflict and raw = node_raw), 'first source node collision must persist its flag without changing the raw text';
  current_revision := (result->>'revision')::bigint;
  result := public.reader_migrate_legacy(book, a, node_source, node_raw);
  assert (result->>'revision')::bigint = current_revision and result->'content' = current_doc, 'repeated first-source collision must be idempotent';
  assert (select count(*) from public.reader_legacy where source_id = node_source) = 1, 'repeated first-source collision must not duplicate recovery copies';
  result := public.reader_personal_snapshot(book, a);
  assert exists (select 1 from jsonb_array_elements(result->'copies') c where c->>'source_id' = node_source::text and c->>'kind' = 'initial' and (c->>'has_conflict')::boolean), 'fresh reads must retain the first-source node conflict prompt';

  result := public.reader_migrate_legacy(book, a, note_source, note_only::text);
  assert result->'content' = current_doc, 'first source note collision must not replace newer cloud content';
  assert exists (select 1 from public.reader_legacy where source_id = note_source and kind = 'initial' and has_conflict), 'first source note collision must persist its flag independently of nodes';
  result := public.reader_migrate_legacy(book, a, identical_source, current_doc::text);
  assert result->'content' = current_doc, 'identical first-source records must leave cloud content unchanged';
  assert exists (select 1 from public.reader_legacy where source_id = identical_source and kind = 'initial' and not has_conflict), 'identical first-source records must not be marked conflicting';
  current_revision := (result->>'revision')::bigint;

  late_raw := jsonb_set(legacy, '{notes,default}', '"后到旧笔记"')::text;
  result := public.reader_migrate_legacy(book, a, source, late_raw);
  assert result->'content' = current_doc and (result->>'revision')::bigint = current_revision, 'late legacy content must not overwrite new content';
  assert (select count(*) from jsonb_array_elements(result->'copies') c where c->>'kind' = 'conflict') = 1, 'late content must remain available';
  assert exists (select 1 from public.reader_legacy where source_id = source and kind = 'conflict' and has_conflict and raw = late_raw), 'late snapshot must persist a true conflict flag and exact raw text';
  result := public.reader_migrate_legacy(book, a, source, late_raw);
  assert (result->>'revision')::bigint = current_revision and result->'content' = current_doc, 'repeated late snapshot must not rewrite cloud content';
  assert (select count(*) from public.reader_legacy where source_id = source and kind = 'conflict' and has_conflict) = 1, 'repeated late snapshot must not duplicate or clear its conflict flag';
  blocked := false;
  begin perform public.reader_save_personal(book, a, 1, legacy); exception when sqlstate 'PT409' then blocked := true; end;
  assert blocked, 'stale tab must fail';

  current_doc := '{"supplements":[],"notes":{}}';
  result := public.reader_save_personal(book, a, current_revision, current_doc);
  result := public.reader_migrate_legacy(book, a, gen_random_uuid(), legacy::text);
  assert result->'content' = current_doc, 'a different old browser must not resurrect deleted content';
  result := public.reader_migrate_legacy(book, a, deleted_node_source, node_raw);
  assert result->'content' = current_doc, 'first-source node tombstones must prevent resurrection';
  assert exists (select 1 from public.reader_legacy where source_id = deleted_node_source and kind = 'initial' and has_conflict), 'first-source node tombstones must persist a conflict flag';
  result := public.reader_migrate_legacy(book, a, deleted_note_source, note_only::text);
  assert result->'content' = current_doc, 'first-source note tombstones must prevent resurrection';
  assert exists (select 1 from public.reader_legacy where source_id = deleted_note_source and kind = 'initial' and has_conflict), 'first-source note tombstones must persist a conflict flag';
  current_revision := (result->>'revision')::bigint;

  blocked := false;
  begin
    perform public.reader_migrate_legacy(book, a, failed_source, jsonb_set(legacy, '{supplements,0,page}', '203')::text);
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'invalid migration must fail';
  assert not exists (select 1 from public.reader_legacy where source_id = failed_source), 'failed transaction must not mark migration complete';
  result := public.reader_personal_snapshot(book, a);
  assert (result->>'revision')::bigint = current_revision and result->'content' = current_doc, 'failed migration must preserve the prior document and revision';
  retry_raw := jsonb_set(legacy, '{supplements,0,id}', '"qa-retry"')::text;
  result := public.reader_migrate_legacy(book, a, failed_source, retry_raw);
  assert result->'content'->'supplements'->0->>'id' = 'qa-retry', 'failed migration must be retryable';
  assert not (result->'content'->'notes' ? 'default'), 'retry must keep deletion protection';
  assert exists (select 1 from public.reader_legacy where source_id = failed_source and kind = 'initial' and has_conflict and raw = retry_raw), 'successful retry must persist its first-source tombstone conflict flag';
  current_doc := result->'content';
  current_revision := (result->>'revision')::bigint;
  result := public.reader_migrate_legacy(book, a, failed_source, retry_raw);
  assert result->'content' = current_doc and (result->>'revision')::bigint = current_revision, 'successful retry must remain idempotent';
  assert (select count(*) from public.reader_legacy where source_id = failed_source and has_conflict) = 1, 'successful retry must retain one flagged initial copy';
  assert not has_table_privilege('authenticated', 'public.reader_legacy', 'UPDATE'), 'recovery copies must remain immutable to readers';

  blocked := false;
  begin update public.reader_books set revision = 'reader-write' where book_id = book; exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'readers must not update default content';
  set local role postgres;
  update public.reader_books set revision = 'after' where book_id = book;
  set local role authenticated;
  result := public.reader_personal_snapshot(book, a);
  assert result->'content' = current_doc, 'default updates must preserve personal content';

  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', b, 'role', 'authenticated')::text, true);
  assert not exists (select 1 from public.reader_personal where owner_id = a), 'RLS must hide another reader';
  assert not exists (select 1 from public.reader_legacy where owner_id = a), 'RLS must hide another reader recovery copies';
  blocked := false;
  begin perform public.reader_personal_snapshot(book, a); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'RPC must bind the requested owner to auth.uid';
  result := public.reader_personal_snapshot(book, b);
  assert result->'content' = '{"supplements":[],"notes":{}}'::jsonb, 'second account must start independently';
  blocked := false;
  begin perform public.reader_save_personal(book, a, 0, current_doc); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'changing auth during a save must not write the previous owner';

  set local role anon;
  assert exists (select 1 from public.reader_books where book_id = book), 'default content must be readable without login';
  blocked := false;
  begin perform 1 from public.reader_personal; exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'anonymous requests must not read personal content';
  set local role postgres;
end;
$$;
rollback;
select 'migration, persisted recovery conflicts, rollback/retry, optimistic conflict, tombstones, defaults and RLS assertions passed' as result;
