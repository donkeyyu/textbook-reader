-- Real RPC checks; all synthetic readers, books and snapshots roll back.
begin;
do $$
declare
  owner uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  book text := 'qa-05-' || gen_random_uuid()::text;
  target_a jsonb; target_b jsonb; link_a jsonb; link_b jsonb;
  body text := '🙂 [[同名]] [[同名]]';
  source jsonb := '{"id":"source-05","title":"来源","markdown":"[[同名]]","page":null,"region":null,"chapterId":null,"sectionId":null}';
  node_a jsonb := '{"id":"target-A","title":"同名","markdown":"A的内容","page":null,"region":null,"chapterId":"chapter-2","sectionId":"section-2"}';
  node_b jsonb := '{"id":"target-B","title":"同名","markdown":"B的内容","page":null,"region":null,"chapterId":"chapter-2","sectionId":"section-2"}';
  payload jsonb; saved jsonb; before jsonb; invalid jsonb; bad jsonb; rejected boolean;
  source_binding jsonb; escaped_binding jsonb; checks integer := 0; text_case record;
begin
  insert into auth.users(id, aud, role, email, created_at, updated_at)
    values (owner, 'authenticated', 'authenticated', owner::text || '@example.invalid', now(), now()),
      (other, 'authenticated', 'authenticated', other::text || '@example.invalid', now(), now());
  insert into public.reader_books(book_id, revision, content) values (book, 'qa-05', '{"pageCount":202}');
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  target_a := jsonb_build_object('bookId', book, 'source', 'personal', 'id', 'target-A');
  target_b := jsonb_build_object('bookId', book, 'source', 'personal', 'id', 'target-B');
  link_a := jsonb_build_object('id', 'instance-A', 'from', 3, 'to', 9, 'label', '同名', 'target', target_a);
  link_b := jsonb_build_object('id', 'instance-B', 'from', 10, 'to', 16, 'label', '同名', 'target', target_b);
  source_binding := jsonb_set(jsonb_set(link_a, '{from}', '0'), '{to}', '6');
  source := source || jsonb_build_object('bindings', jsonb_build_array(source_binding));
  payload := jsonb_build_object('supplements', jsonb_build_array(source, node_a, node_b),
    'notes', jsonb_build_object('default-source', body),
    'noteBindings', jsonb_build_object('default-source', jsonb_build_array(link_a, link_b)));
  saved := public.reader_save_personal(book, owner, 0, payload);
  assert public.reader_personal_snapshot(book, owner) = saved and saved->'content' = payload,
    'body and per-instance bindings in both text sources must round trip unchanged';
  assert saved->'content'->'noteBindings'->'default-source'->0->'target' = target_a
    and saved->'content'->'noteBindings'->'default-source'->1->'target' = target_b,
    'same-title targets after a surrogate pair must remain separate';

  before := saved;
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(link_a, '{from}', '3.5'), jsonb_set(link_a, '{from}', '-1'),
    jsonb_set(link_a, '{from}', '1'), jsonb_set(link_a, '{to}', '100000000000000000000000000000000000'),
    jsonb_set(link_a, '{to}', '17'), jsonb_set(link_a, '{label}', '"别名"'),
    jsonb_set(link_a, '{target,bookId}', '"different-book"'),
    jsonb_set(link_a, '{target,source}', '"unknown"'), link_a - 'target',
    jsonb_set(link_a, '{id}', '""'))) loop
    invalid := jsonb_set(payload, '{noteBindings,default-source,0}', bad);
    invalid := jsonb_set(invalid, '{supplements,0,markdown}', '"[[同名]] 失败不能覆盖原正文"');
    rejected := false;
    begin perform public.reader_save_personal(book, owner, 1, invalid);
    exception when check_violation then rejected := true; end;
    assert rejected, 'invalid identity or range must fail as a validation error';
    assert public.reader_personal_snapshot(book, owner) = before,
      'failed validation must preserve body, bindings and revision together';
    checks := checks + 1;
  end loop;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(payload, '{noteBindings,default-source,1,id}', '"instance-A"'),
    jsonb_set(payload, '{noteBindings,default-source,1}', jsonb_set(link_a, '{id}', '"overlap"')),
    payload || jsonb_build_object('noteBindings', jsonb_build_object('missing-note', jsonb_build_array(link_a))),
    jsonb_set(payload, '{noteBindings}', 'null'),
    jsonb_set(payload, '{noteBindings,default-source}', '{}'),
    jsonb_set(payload, '{supplements,0,bindings,0,target,bookId}', '"different-book"'))) loop
    rejected := false;
    begin perform public.reader_save_personal(book, owner, 1, invalid);
    exception when check_violation then rejected := true; end;
    assert rejected, 'duplicate/overlapping instances, orphan metadata and invalid metadata shapes must fail';
    assert public.reader_personal_snapshot(book, owner) = before;
    checks := checks + 1;
  end loop;

  for text_case in select * from (values
    ('`[[同名]]`', 1, 7), (E'```\n[[同名]]\n```', 4, 10),
    ('    [[同名]]', 4, 10), (chr(92) || '[[同名]]', 1, 7),
    ('<div>[[同名]]</div>', 5, 11), ('[[同名', 0, 4)
  ) cases(markdown, from_unit, to_unit) loop
    bad := jsonb_set(jsonb_set(source_binding, '{from}', to_jsonb(text_case.from_unit)), '{to}', to_jsonb(text_case.to_unit));
    assert not public.reader_valid_bindings(text_case.markdown, jsonb_build_array(bad), book),
      'obvious code, escaped, HTML and unfinished tokens cannot carry valid bindings';
    checks := checks + 1;
  end loop;
  escaped_binding := source_binding || jsonb_build_object('label', '括]号', 'to', 8);
  assert public.reader_valid_bindings('[[括' || chr(92) || ']号]]', jsonb_build_array(escaped_binding), book),
    'escaped label punctuation must be decoded without changing target identity';

  -- The Markdown bytes stay unchanged; only one chosen target changes.
  payload := jsonb_set(payload, '{noteBindings,default-source,0,target}', target_b);
  saved := public.reader_save_personal(book, owner, 1, payload);
  assert saved->'content'->'notes' = before->'content'->'notes' and (saved->>'revision')::integer = 2,
    'binding-only changes must commit with their own revision';
  assert public.reader_save_personal(book, owner, 1, payload) = saved,
    'retry after a lost response must be idempotent for the exact full snapshot';
  before := saved;
  rejected := false;
  begin perform public.reader_save_personal(book, owner, 1, jsonb_set(payload, '{noteBindings,default-source,0,target}', target_a));
  exception when sqlstate 'PT409' then rejected := true; end;
  assert rejected and public.reader_personal_snapshot(book, owner) = before,
    'stale metadata cannot overwrite a newer same-text binding choice';

  -- Renaming/removing a target, and making a new same-title node, do not rewrite references.
  payload := jsonb_set(payload, '{supplements,1,title}', '"新标题"');
  saved := public.reader_save_personal(book, owner, 2, payload);
  assert saved->'content'->'supplements'->0->'bindings'->0->'target' = target_a;
  payload := jsonb_set(payload, '{supplements}', jsonb_build_array(source,
    node_b || '{"id":"new-same-title"}'::jsonb));
  saved := public.reader_save_personal(book, owner, 3, payload);
  assert saved->'content'->'noteBindings'->'default-source'->1->'target' = target_b,
    'a deleted target stays bound to its missing identity, never a new same-title node';
  payload := jsonb_set(payload, '{supplements,0,bindings,0,target}',
    jsonb_build_object('bookId', book, 'source', 'default', 'id', 'removed-default'));
  saved := public.reader_save_personal(book, owner, 4, payload);
  assert saved->'content'->'supplements'->0->'bindings'->0->'target'->>'id' = 'removed-default',
    'removed default targets remain stored for invalid-link display';
  payload := jsonb_set(payload, '{supplements,0,bindings,0,target}',
    jsonb_build_object('bookId', book, 'source', 'personal', 'id', 'source-05'));
  saved := public.reader_save_personal(book, owner, 5, payload);
  assert saved->'content'->'supplements'->0->'bindings'->0->'target'->>'id' = 'source-05',
    'self-reference is valid persisted identity';

  -- Ordinary old snapshots still work. Unbound code stays ordinary Markdown.
  assert public.reader_valid_personal('{"supplements":[],"notes":{"old":"[[未绑定]]"}}', 202),
    'legacy notes strings need no binding metadata';
  assert public.reader_valid_personal(jsonb_build_object('supplements', '[]'::jsonb,
    'notes', jsonb_build_object('code', '`[[普通文字]]`'), 'noteBindings', jsonb_build_object('code', '[]'::jsonb)), 202, book);
  rejected := false;
  begin perform public.reader_migrate_legacy(book, owner, gen_random_uuid(),
    jsonb_set(payload, '{noteBindings,default-source,0,target,bookId}', '"other-book"')::text);
  exception when check_violation then rejected := true; end;
  assert rejected and public.reader_personal_snapshot(book, owner) = saved,
    'legacy entry cannot bypass book isolation or leave a partial migration';

  perform set_config('request.jwt.claim.sub', other::text, true);
  assert not exists (select 1 from public.reader_personal where owner_id = owner), 'binding snapshots remain owner-private';
  rejected := false;
  begin perform public.reader_save_personal(book, owner, 6, payload);
  exception when insufficient_privilege then rejected := true; end;
  assert rejected, 'RPC account mismatch remains rejected';
  set local role postgres;
  assert checks = 22, 'all invalid-range, atomicity and syntax cases executed';
end;
$$;
rollback;
select 'link snapshots: 22 rejection cases, UTF-16, same-name identity, binding-only revision, atomic failure, retry, rename/delete/default/self, legacy and RLS passed; fixtures rolled back' as result;
