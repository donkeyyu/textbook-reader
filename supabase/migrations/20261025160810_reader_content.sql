create table public.reader_books (
  book_id text primary key,
  revision text not null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.reader_personal (
  owner_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null references public.reader_books(book_id),
  revision bigint not null default 0 check (revision >= 0),
  content jsonb not null default '{"supplements":[],"notes":{}}',
  tombstones jsonb not null default '{"supplements":{},"notes":{}}',
  updated_at timestamptz not null default now(),
  primary key (owner_id, book_id)
);
create index reader_personal_book_id on public.reader_personal(book_id);

create table public.reader_legacy (
  owner_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null references public.reader_books(book_id),
  source_id uuid not null,
  snapshot_hash text not null,
  raw text,
  kind text not null check (kind in ('initial', 'conflict')),
  created_at timestamptz not null default now(),
  primary key (owner_id, book_id, source_id, snapshot_hash)
);
create unique index reader_legacy_initial on public.reader_legacy(owner_id, book_id, source_id) where kind = 'initial';
create index reader_legacy_book_id on public.reader_legacy(book_id);

alter table public.reader_books enable row level security;
alter table public.reader_personal enable row level security;
alter table public.reader_legacy enable row level security;
revoke all on public.reader_books, public.reader_personal, public.reader_legacy from anon, authenticated;
grant select on public.reader_books to anon, authenticated;
grant select, insert, update on public.reader_personal to authenticated;
grant select, insert on public.reader_legacy to authenticated;
grant all on public.reader_books, public.reader_personal, public.reader_legacy to service_role;
create policy reader_books_read on public.reader_books for select to anon, authenticated using (true);
create policy reader_personal_read on public.reader_personal for select to authenticated using ((select auth.uid()) = owner_id);
create policy reader_personal_insert on public.reader_personal for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy reader_personal_update on public.reader_personal for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy reader_legacy_read on public.reader_legacy for select to authenticated using ((select auth.uid()) = owner_id);
create policy reader_legacy_insert on public.reader_legacy for insert to authenticated with check ((select auth.uid()) = owner_id);

create function public.reader_valid_personal(p_content jsonb, p_pages integer)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; box jsonb; x numeric; y numeric; w numeric; h numeric;
begin
  if jsonb_typeof(p_content) is distinct from 'object'
    or jsonb_typeof(p_content->'supplements') is distinct from 'array'
    or jsonb_typeof(p_content->'notes') is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_each(p_content->'notes') n where jsonb_typeof(n.value) <> 'string') then return false; end if;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(p_content->'supplements')) then return false; end if;
  for item in select value from jsonb_array_elements(p_content->'supplements') loop
    if jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^[A-Za-z0-9_-]+$'
      or jsonb_typeof(item->'title') is distinct from 'string' or btrim(item->>'title') = ''
      or jsonb_typeof(item->'markdown') is distinct from 'string' or btrim(item->>'markdown') = ''
      or jsonb_typeof(item->'page') is distinct from 'number'
      or jsonb_typeof(item->'region') is distinct from 'object' then return false; end if;
    if (item->>'page')::numeric <> trunc((item->>'page')::numeric)
      or (item->>'page')::numeric not between 1 and p_pages then return false; end if;
    box := item->'region';
    if jsonb_typeof(box->'x') is distinct from 'number' or jsonb_typeof(box->'y') is distinct from 'number'
      or jsonb_typeof(box->'width') is distinct from 'number' or jsonb_typeof(box->'height') is distinct from 'number' then return false; end if;
    x := (box->>'x')::numeric; y := (box->>'y')::numeric; w := (box->>'width')::numeric; h := (box->>'height')::numeric;
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > 1.000001 or y + h > 1.000001 then return false; end if;
  end loop;
  return true;
end;
$$;

create function public.reader_personal_snapshot(p_book_id text, p_owner_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then raise insufficient_privilege using message = 'Reader account changed'; end if;
  select jsonb_build_object('owner_id', p_owner_id, 'revision', p.revision, 'content', p.content)
    into result from public.reader_personal p where p.owner_id = p_owner_id and p.book_id = p_book_id;
  result := coalesce(result, jsonb_build_object('owner_id', p_owner_id, 'revision', 0, 'content', '{"supplements":[],"notes":{}}'::jsonb));
  return result || jsonb_build_object('copies', coalesce((select jsonb_agg(to_jsonb(c) - 'owner_id' - 'book_id' order by c.created_at desc)
    from public.reader_legacy c where c.owner_id = p_owner_id and c.book_id = p_book_id), '[]'::jsonb));
end;
$$;

create function public.reader_save_personal(p_book_id text, p_owner_id uuid, p_expected_revision bigint, p_content jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.reader_personal; page_count integer; removed record; v_tombstones jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then raise insufficient_privilege using message = 'Reader account changed'; end if;
  select (content->>'pageCount')::integer into page_count from public.reader_books where book_id = p_book_id;
  if page_count is null or not public.reader_valid_personal(p_content, page_count) then raise check_violation using message = 'Invalid reader content'; end if;
  insert into public.reader_personal(owner_id, book_id) values (p_owner_id, p_book_id) on conflict do nothing;
  select * into current_row from public.reader_personal where owner_id = p_owner_id and book_id = p_book_id for update;
  if current_row.revision <> p_expected_revision then
    -- A lost HTTP response can be retried without replacing a newer document.
    if current_row.content = p_content then return public.reader_personal_snapshot(p_book_id, p_owner_id); end if;
    raise serialization_failure using message = 'Reader content was changed by another tab';
  end if;
  v_tombstones := current_row.tombstones;
  for removed in select value->>'id' as id from jsonb_array_elements(current_row.content->'supplements') old
    where not exists (select 1 from jsonb_array_elements(p_content->'supplements') new where new.value->>'id' = old.value->>'id') loop
    v_tombstones := jsonb_set(v_tombstones, array['supplements', removed.id], 'true'::jsonb);
  end loop;
  for removed in select key as id from jsonb_each(current_row.content->'notes') where not (p_content->'notes' ? key) loop
    v_tombstones := jsonb_set(v_tombstones, array['notes', removed.id], 'true'::jsonb);
  end loop;
  update public.reader_personal set content = p_content, tombstones = v_tombstones, revision = revision + 1, updated_at = now()
    where owner_id = p_owner_id and book_id = p_book_id;
  return public.reader_personal_snapshot(p_book_id, p_owner_id);
end;
$$;

create function public.reader_migrate_legacy(p_book_id text, p_owner_id uuid, p_source_id uuid, p_raw text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.reader_personal; legacy jsonb; merged jsonb; item jsonb; note record; page_count integer;
  digest text := encode(sha256(convert_to(coalesce(p_raw, 'null'), 'UTF8')), 'hex');
  initial_exists boolean;
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then raise insufficient_privilege using message = 'Reader account changed'; end if;
  insert into public.reader_personal(owner_id, book_id) values (p_owner_id, p_book_id) on conflict do nothing;
  select * into current_row from public.reader_personal where owner_id = p_owner_id and book_id = p_book_id for update;
  if exists (select 1 from public.reader_legacy where owner_id = p_owner_id and book_id = p_book_id and source_id = p_source_id and snapshot_hash = digest) then
    return public.reader_personal_snapshot(p_book_id, p_owner_id);
  end if;
  select exists (select 1 from public.reader_legacy where owner_id = p_owner_id and book_id = p_book_id and source_id = p_source_id and kind = 'initial') into initial_exists;
  insert into public.reader_legacy(owner_id, book_id, source_id, snapshot_hash, raw, kind)
    values (p_owner_id, p_book_id, p_source_id, digest, p_raw, case when initial_exists then 'conflict' else 'initial' end);
  if initial_exists then return public.reader_personal_snapshot(p_book_id, p_owner_id); end if;
  legacy := coalesce(p_raw::jsonb, '{"supplements":[],"notes":{}}'::jsonb);
  select (content->>'pageCount')::integer into page_count from public.reader_books where book_id = p_book_id;
  -- Validation deliberately stays in this transaction with the source record.
  -- An invalid/interrupted import cannot leave a completion record behind.
  if page_count is null or not public.reader_valid_personal(legacy, page_count) then raise check_violation using message = 'Invalid legacy reader content'; end if;
  merged := current_row.content;
  for item in select value from jsonb_array_elements(legacy->'supplements') loop
    if not (current_row.tombstones->'supplements' ? (item->>'id'))
      and not exists (select 1 from jsonb_array_elements(merged->'supplements') p where p.value->>'id' = item->>'id') then
      merged := jsonb_set(merged, '{supplements}', (merged->'supplements') || jsonb_build_array(item));
    end if;
  end loop;
  for note in select key, value from jsonb_each(legacy->'notes') loop
    if not (current_row.tombstones->'notes' ? note.key) and not (merged->'notes' ? note.key) then merged := jsonb_set(merged, array['notes', note.key], note.value); end if;
  end loop;
  update public.reader_personal set content = merged, revision = revision + 1, updated_at = now()
    where owner_id = p_owner_id and book_id = p_book_id;
  return public.reader_personal_snapshot(p_book_id, p_owner_id);
end;
$$;

revoke execute on function public.reader_valid_personal(jsonb, integer), public.reader_personal_snapshot(text, uuid), public.reader_save_personal(text, uuid, bigint, jsonb), public.reader_migrate_legacy(text, uuid, uuid, text) from public, anon;
grant execute on function public.reader_valid_personal(jsonb, integer), public.reader_personal_snapshot(text, uuid), public.reader_save_personal(text, uuid, bigint, jsonb), public.reader_migrate_legacy(text, uuid, uuid, text) to authenticated;
