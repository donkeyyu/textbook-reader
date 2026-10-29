-- Use typed empty arrays and the integer FOR loop's own variable.
create or replace function public.reader_link_text_allowed(p_markdown text, p_at integer)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  line text; line_at integer := 1; line_end integer; previous_blank boolean := true;
  content_line text; content_base integer; indent integer; marker text; spacing integer;
  list_columns integer[] := array[]::integer[]; blank boolean; indented_code boolean := false; code_base integer := 0;
  fence text := ''; fence_size integer := 0; fence_base integer := 0; run text; html text := '';
  i integer := 1; j integer; size integer; closing integer; slashes integer;
begin
  for line in select value from unnest(string_to_array(p_markdown, E'\n')) value loop
    line_end := line_at + char_length(line);
    blank := btrim(line, E' \t\r') = '';
    indent := char_length(line) - char_length(ltrim(line, ' '));
    if indented_code and not blank and indent < code_base + 4 and left(line, 1) <> E'\t' then indented_code := false; end if;
    if indented_code then
      if p_at between line_at and line_end then return false; end if;
      previous_blank := blank; line_at := line_end + 1; continue;
    end if;
    -- A list's fence ends when a nonblank line leaves that list container.
    if fence <> '' and not blank and indent < fence_base then fence := ''; end if;
    if fence = '' and html = '' and not blank then
      while cardinality(list_columns) > 0 and indent < list_columns[cardinality(list_columns)]
        and (previous_blank or line ~ '^ *([-+*]|[0-9]{1,9}[.)])( +|$)'
          or line ~ '^ {0,3}(#{1,6}( |$)|>|`{3,}|~{3,}|<)') loop
        list_columns := list_columns[1:cardinality(list_columns) - 1];
      end loop;
    end if;
    content_base := coalesce(list_columns[cardinality(list_columns)], 0);
    -- Lazy paragraph continuation can be less indented than its list item.
    if content_base > indent then content_base := 0; end if;
    content_line := substring(line, content_base + 1); marker := null;
    if fence = '' and html = '' and content_line !~ '^ {0,3}((- *){3,}|(\* *){3,}|(_ *){3,})$' then
      marker := substring(content_line from '^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])(?: +|$)');
      if marker is not null then
        spacing := char_length(marker) - char_length(rtrim(marker, ' '));
        -- More than four spaces after a marker starts item content with
        -- one separator; the remaining indentation can itself be code.
        if spacing > 4 then marker := left(marker, char_length(marker) - spacing + 1); end if;
        content_line := substring(content_line, char_length(marker) + 1);
        content_base := content_base + char_length(marker) + case when spacing = 0 then 1 else 0 end;
        list_columns := array_append(list_columns, content_base);
      end if;
    end if;
    run := substring(content_line from '^ {0,3}(`{3,}|~{3,})');
    if fence <> '' then
      if p_at between line_at and line_end then return false; end if;
      if left(run, 1) = fence and char_length(run) >= fence_size
        and btrim(substring(content_line from '^ {0,3}[`~]+(.*)$')) = '' then fence := ''; end if;
    elsif run is not null then
      if p_at between line_at and line_end then return false; end if;
      fence := left(run, 1); fence_size := char_length(run); fence_base := content_base;
    elsif html <> '' then
      if p_at between line_at and line_end then return false; end if;
      if (html = 'block' and blank) or (html <> 'block' and lower(content_line) like '%</' || html || '>%') then html := ''; end if;
    elsif content_line ~ '^ {0,3}<(script|pre|style|textarea)([[:space:]>])' then
      if p_at between line_at and line_end then return false; end if;
      html := substring(content_line from '^ {0,3}<(script|pre|style|textarea)');
      if lower(content_line) like '%</' || html || '>%' then html := ''; end if;
    elsif content_line ~ '^ {0,3}<(!--|/?[A-Za-z][A-Za-z0-9-]*([[:space:]>]))' then
      if p_at between line_at and line_end then return false; end if;
      html := 'block';
    elsif not blank and (previous_blank or marker is not null) and content_line ~ '^( {4}|\t)' then
      indented_code := true; code_base := content_base;
      if p_at between line_at and line_end then return false; end if;
    end if;
    if line_end >= p_at then exit; end if;
    previous_blank := blank;
    line_at := line_end + 1;
  end loop;
  -- Keep the existing closed-inline-code guard; unmatched backticks stay text.
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

create or replace function public.reader_valid_bindings(p_markdown text, p_bindings jsonb, p_book_id text)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  binding jsonb; target jsonb; ids text[] := array[]::text[]; starts integer[] := array[]::integer[]; ends integer[] := array[]::integer[];
  from_unit integer; to_unit integer; unit_at integer; start_at integer; end_at integer;
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
  initial_exists := exists (select 1 from public.reader_legacy where owner_id = p_owner_id and book_id = p_book_id and source_id = p_source_id and kind = 'initial');
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

-- Read personal content and recovery copies from one query snapshot.
-- Writers call this after their separate INSERT/UPDATE statements.
alter function public.reader_personal_snapshot(text, uuid) stable;
