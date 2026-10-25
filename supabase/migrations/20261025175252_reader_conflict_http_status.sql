create or replace function public.reader_save_personal(p_book_id text, p_owner_id uuid, p_expected_revision bigint, p_content jsonb)
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
    raise sqlstate 'PT409' using message = 'Reader content was changed by another tab';
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
