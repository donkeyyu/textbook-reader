-- Binding metadata stays in the same personal snapshot as its Markdown.
-- These pure helpers neither resolve titles nor require a target to still exist.
create function public.reader_link_text_allowed(p_markdown text, p_at integer)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  line text; line_at integer := 1; line_end integer; previous_blank boolean := true;
  fence text := ''; fence_size integer := 0; run text; html text := '';
  i integer := 1; j integer; size integer; closing integer; slashes integer;
begin
  for line in select value from unnest(string_to_array(p_markdown, E'\n')) value loop
    line_end := line_at + char_length(line);
    run := substring(line from '^ {0,3}(`{3,}|~{3,})');
    if fence <> '' then
      if p_at between line_at and line_end then return false; end if;
      if left(run, 1) = fence and char_length(run) >= fence_size
        and btrim(substring(line from '^ {0,3}[`~]+(.*)$')) = '' then fence := ''; end if;
    elsif run is not null then
      if p_at between line_at and line_end then return false; end if;
      fence := left(run, 1); fence_size := char_length(run);
    elsif html <> '' then
      if p_at between line_at and line_end then return false; end if;
      if (html = 'block' and btrim(line) = '') or (html <> 'block' and lower(line) like '%</' || html || '>%') then html := ''; end if;
    elsif line ~ '^ {0,3}<(script|pre|style|textarea)([[:space:]>])' then
      if p_at between line_at and line_end then return false; end if;
      html := substring(line from '^ {0,3}<(script|pre|style|textarea)');
      if lower(line) like '%</' || html || '>%' then html := ''; end if;
    elsif line ~ '^ {0,3}<(!--|/?[A-Za-z][A-Za-z0-9-]*([[:space:]>]))' then
      if p_at between line_at and line_end then return false; end if;
      html := 'block';
    elsif previous_blank and line ~ '^( {4}|\t)' and p_at between line_at and line_end then return false;
    end if;
    if line_end >= p_at then exit; end if;
    previous_blank := btrim(line) = '';
    line_at := line_end + 1;
  end loop;
  -- Reject a token inside an actual closed inline-code span. An unmatched
  -- backtick stays text. Full CommonMark eligibility is checked by the client.
  while i < p_at loop
    if substring(p_markdown, i, 1) <> '`' then i := i + 1; continue; end if;
    slashes := 0; j := i - 1;
    while j > 0 and substring(p_markdown, j, 1) = chr(92) loop slashes := slashes + 1; j := j - 1; end loop;
    if slashes % 2 = 1 then i := i + 1; continue; end if;
    size := 1;
    while substring(p_markdown, i + size, 1) = '`' loop size := size + 1; end loop;
    j := i + size; closing := 0;
    while j <= char_length(p_markdown) loop
      if substring(p_markdown, j, 2) = E'\n\n' then exit; end if;
      if substring(p_markdown, j, 1) = '`' then
        closing := j;
        while substring(p_markdown, j, 1) = '`' loop j := j + 1; end loop;
        if j - closing = size then exit; end if;
        closing := 0;
      else j := j + 1; end if;
    end loop;
    if closing > 0 then
      if p_at < closing then return false; end if;
      i := closing + size;
    else i := i + size; end if;
  end loop;
  return true;
end;
$$;

create function public.reader_valid_bindings(p_markdown text, p_bindings jsonb, p_book_id text)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  binding jsonb; target jsonb; ids text[] := '{}'; starts integer[] := '{}'; ends integer[] := '{}';
  from_unit integer; to_unit integer; unit_at integer; char_at integer; start_at integer; end_at integer;
  raw text; label text; ch text; next_ch text; i integer; j integer; slashes integer;
begin
  if p_markdown is null or jsonb_typeof(p_bindings) is distinct from 'array' then return false; end if;
  for binding in select value from jsonb_array_elements(p_bindings) loop
    target := binding->'target';
    if jsonb_typeof(binding) is distinct from 'object'
      or jsonb_typeof(binding->'id') is distinct from 'string' or binding->>'id' !~ '^[A-Za-z0-9_-]+$'
      or binding->>'id' = any(ids)
      or jsonb_typeof(binding->'from') is distinct from 'number' or jsonb_typeof(binding->'to') is distinct from 'number'
      or jsonb_typeof(binding->'label') is distinct from 'string' or btrim(binding->>'label') = ''
      or jsonb_typeof(target) is distinct from 'object'
      or jsonb_typeof(target->'bookId') is distinct from 'string' or btrim(target->>'bookId') = ''
      or (p_book_id is not null and target->>'bookId' <> p_book_id)
      or jsonb_typeof(target->'source') is distinct from 'string' or target->>'source' not in ('default', 'personal')
      or jsonb_typeof(target->'id') is distinct from 'string' or btrim(target->>'id') = '' then return false; end if;
    if (binding->>'from')::numeric <> trunc((binding->>'from')::numeric)
      or (binding->>'to')::numeric <> trunc((binding->>'to')::numeric)
      or (binding->>'from')::numeric < 0 or (binding->>'to')::numeric > char_length(p_markdown) * 2
      or (binding->>'to')::numeric <= (binding->>'from')::numeric then return false; end if;
    from_unit := (binding->>'from')::integer; to_unit := (binding->>'to')::integer;
    if exists (select 1 from unnest(starts, ends) previous(a, b) where from_unit < b and to_unit > a) then return false; end if;
    -- PostgreSQL counts Unicode characters; CodeMirror stores UTF-16 units.
    -- Only exact character boundaries are accepted, never half a surrogate pair.
    unit_at := 0; start_at := null; end_at := null;
    for char_at in 1..char_length(p_markdown) + 1 loop
      if unit_at = from_unit then start_at := char_at; end if;
      if unit_at = to_unit then end_at := char_at; exit; end if;
      ch := substring(p_markdown, char_at, 1);
      unit_at := unit_at + case when octet_length(ch) = 4 then 2 else 1 end;
    end loop;
    if start_at is null or end_at is null then return false; end if;
    raw := substring(p_markdown, start_at, end_at - start_at);
    if left(raw, 2) <> '[[' or right(raw, 2) <> ']]' or char_length(raw) < 5
      or raw ~ E'[\r\n]' or not public.reader_link_text_allowed(p_markdown, start_at) then return false; end if;
    slashes := 0; i := start_at - 1;
    while i > 0 and substring(p_markdown, i, 1) = chr(92) loop slashes := slashes + 1; i := i - 1; end loop;
    if slashes % 2 = 1 then return false; end if;
    raw := substring(raw, 3, char_length(raw) - 4); label := ''; i := 1;
    while i <= char_length(raw) loop
      ch := substring(raw, i, 1);
      if ch in ('[', ']') then return false; end if;
      if ch = chr(92) then
        if i = char_length(raw) then return false; end if;
        next_ch := substring(raw, i + 1, 1); j := ascii(next_ch);
        if j between 33 and 47 or j between 58 and 64 or j between 91 and 96 or j between 123 and 126 then
          label := label || next_ch; i := i + 2; continue;
        end if;
      end if;
      label := label || ch; i := i + 1;
    end loop;
    if label <> binding->>'label' then return false; end if;
    ids := array_append(ids, binding->>'id'); starts := array_append(starts, from_unit); ends := array_append(ends, to_unit);
  end loop;
  return true;
end;
$$;

create or replace function public.reader_valid_personal(p_content jsonb, p_pages integer, p_book_id text)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; note record; box jsonb; x numeric; y numeric; w numeric; h numeric;
begin
  if jsonb_typeof(p_content) is distinct from 'object'
    or jsonb_typeof(p_content->'supplements') is distinct from 'array'
    or jsonb_typeof(p_content->'notes') is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_each(p_content->'notes') n where jsonb_typeof(n.value) <> 'string') then return false; end if;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(p_content->'supplements')) then return false; end if;
  if p_content ? 'noteBindings' then
    if jsonb_typeof(p_content->'noteBindings') is distinct from 'object' then return false; end if;
    for note in select key, value from jsonb_each(p_content->'noteBindings') loop
      if not (p_content->'notes' ? note.key)
        or not public.reader_valid_bindings(p_content->'notes'->>note.key, note.value, p_book_id) then return false; end if;
    end loop;
  end if;

  for item in select value from jsonb_array_elements(p_content->'supplements') loop
    if jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^[A-Za-z0-9_-]+$'
      or jsonb_typeof(item->'title') is distinct from 'string' or btrim(item->>'title') = ''
      or jsonb_typeof(item->'markdown') is distinct from 'string' or btrim(item->>'markdown') = ''
      then return false; end if;
    if exists (select 1 from jsonb_each(item) pair where pair.key in ('chapterId', 'sectionId')
      and pair.value <> 'null'::jsonb and (jsonb_typeof(pair.value) <> 'string' or btrim(pair.value #>> '{}') = '')) then return false; end if;
    if item ? 'bindings' and not public.reader_valid_bindings(item->>'markdown', item->'bindings', p_book_id) then return false; end if;
    -- Both fields are explicitly null for a free node. A partial location is invalid.
    if item->'page' = 'null'::jsonb and item->'region' = 'null'::jsonb then continue; end if;
    if jsonb_typeof(item->'page') is distinct from 'number'
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

-- Keep the original validator signature for existing callers and legacy tests.
create or replace function public.reader_valid_personal(p_content jsonb, p_pages integer)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select public.reader_valid_personal(p_content, p_pages, null::text);
$$;

create or replace function public.reader_save_personal(p_book_id text, p_owner_id uuid, p_expected_revision bigint, p_content jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.reader_personal; page_count integer; removed record; v_tombstones jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then raise insufficient_privilege using message = 'Reader account changed'; end if;
  select (content->>'pageCount')::integer into page_count from public.reader_books where book_id = p_book_id;
  if page_count is null or not public.reader_valid_personal(p_content, page_count, p_book_id) then raise check_violation using message = 'Invalid reader content'; end if;
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
  if page_count is null or not public.reader_valid_personal(legacy, page_count, p_book_id) then raise check_violation using message = 'Invalid legacy reader content'; end if;
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


revoke execute on function public.reader_link_text_allowed(text, integer), public.reader_valid_bindings(text, jsonb, text), public.reader_valid_personal(jsonb, integer, text) from public, anon;
grant execute on function public.reader_link_text_allowed(text, integer), public.reader_valid_bindings(text, jsonb, text), public.reader_valid_personal(jsonb, integer, text) to authenticated;
