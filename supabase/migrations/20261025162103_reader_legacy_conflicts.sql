alter table public.reader_legacy add column has_conflict boolean not null default false;

-- Existing late snapshots are already known conflicts. Their raw text stays intact.
update public.reader_legacy set has_conflict = true where kind = 'conflict';

create or replace function public.reader_migrate_legacy(p_book_id text, p_owner_id uuid, p_source_id uuid, p_raw text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.reader_personal; legacy jsonb; merged jsonb; item jsonb; existing_item jsonb; note record; page_count integer;
  digest text := encode(sha256(convert_to(coalesce(p_raw, 'null'), 'UTF8')), 'hex');
  initial_exists boolean; v_has_conflict boolean := false;
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then raise insufficient_privilege using message = 'Reader account changed'; end if;
  insert into public.reader_personal(owner_id, book_id) values (p_owner_id, p_book_id) on conflict do nothing;
  select * into current_row from public.reader_personal where owner_id = p_owner_id and book_id = p_book_id for update;
  if exists (select 1 from public.reader_legacy where owner_id = p_owner_id and book_id = p_book_id and source_id = p_source_id and snapshot_hash = digest) then
    return public.reader_personal_snapshot(p_book_id, p_owner_id);
  end if;
  select exists (select 1 from public.reader_legacy where owner_id = p_owner_id and book_id = p_book_id and source_id = p_source_id and kind = 'initial') into initial_exists;
  if initial_exists then
    insert into public.reader_legacy(owner_id, book_id, source_id, snapshot_hash, raw, kind, has_conflict)
      values (p_owner_id, p_book_id, p_source_id, digest, p_raw, 'conflict', true);
    return public.reader_personal_snapshot(p_book_id, p_owner_id);
  end if;
  legacy := coalesce(p_raw::jsonb, '{"supplements":[],"notes":{}}'::jsonb);
  select (content->>'pageCount')::integer into page_count from public.reader_books where book_id = p_book_id;
  if page_count is null or not public.reader_valid_personal(legacy, page_count) then raise check_violation using message = 'Invalid legacy reader content'; end if;
  merged := current_row.content;
  for item in select value from jsonb_array_elements(legacy->'supplements') loop
    select value into existing_item from jsonb_array_elements(merged->'supplements') p where p.value->>'id' = item->>'id';
    if current_row.tombstones->'supplements' ? (item->>'id') then
      v_has_conflict := true;
    elsif existing_item is not null then
      if existing_item is distinct from item then v_has_conflict := true; end if;
    else
      merged := jsonb_set(merged, '{supplements}', (merged->'supplements') || jsonb_build_array(item));
    end if;
  end loop;
  for note in select key, value from jsonb_each(legacy->'notes') loop
    if current_row.tombstones->'notes' ? note.key then
      v_has_conflict := true;
    elsif merged->'notes' ? note.key then
      if (merged->'notes')->note.key is distinct from note.value then v_has_conflict := true; end if;
    else
      merged := jsonb_set(merged, array['notes', note.key], note.value);
    end if;
  end loop;
  -- Compute the flag before inserting: recovery rows remain insert-only for readers.
  insert into public.reader_legacy(owner_id, book_id, source_id, snapshot_hash, raw, kind, has_conflict)
    values (p_owner_id, p_book_id, p_source_id, digest, p_raw, 'initial', v_has_conflict);
  update public.reader_personal set content = merged, revision = revision + 1, updated_at = now()
    where owner_id = p_owner_id and book_id = p_book_id;
  return public.reader_personal_snapshot(p_book_id, p_owner_id);
end;
$$;

revoke execute on function public.reader_migrate_legacy(text, uuid, uuid, text) from public, anon;
grant execute on function public.reader_migrate_legacy(text, uuid, uuid, text) to authenticated;
