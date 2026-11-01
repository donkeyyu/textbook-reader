-- Prepared for ticket 18. Run only after reviewing/deploying the archive schema.
-- Fixtures roll back; this never reads or writes student personal tables.
begin;
do $$
declare
  book text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  revision text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  blocked boolean;
begin
  set local role service_role;
  insert into public.reader_initial_versions(textbook, version, package)
    values (book, revision, jsonb_build_object('textbook', book, 'version', revision));
  assert not has_table_privilege('service_role', 'public.reader_initial_versions', 'UPDATE,DELETE,TRUNCATE'), 'publisher must only insert/read';
  set local role anon;
  assert exists (select 1 from public.reader_initial_versions where textbook = book and version = revision), 'initial versions must be readable without login';
  blocked := false;
  begin insert into public.reader_initial_versions(textbook, version, package) values (book, revision, '{}'::jsonb);
    exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'anonymous clients must not insert';
  assert not has_table_privilege('anon', 'public.reader_initial_versions', 'UPDATE,DELETE,TRUNCATE'), 'anonymous clients must not alter history';
  set local role authenticated;
  assert exists (select 1 from public.reader_initial_versions where textbook = book and version = revision), 'signed-in readers can read the same initial version';
  assert not has_table_privilege('authenticated', 'public.reader_initial_versions', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'signed-in readers cannot publish or alter history';
  set local role postgres;
  blocked := false;
  begin update public.reader_initial_versions set package = package where textbook = book;
    exception when raise_exception then blocked := true; end;
  assert blocked, 'immutable trigger must block owner updates';
  blocked := false;
  begin delete from public.reader_initial_versions where textbook = book;
    exception when raise_exception then blocked := true; end;
  assert blocked, 'immutable trigger must block owner deletes';
  blocked := false;
  begin insert into public.reader_initial_versions(textbook, version, package) values (book, repeat('a', 64), '{}'::jsonb);
    exception when check_violation then blocked := true; end;
  assert blocked, 'a missing/mismatched package identity must fail';
end;
$$;
rollback;
select 'Initial archive privileges, immutability and identity checks passed' as result;
