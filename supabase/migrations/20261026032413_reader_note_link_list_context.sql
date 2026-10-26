-- Preserve list content columns before deciding whether four spaces mean code.
-- No node, snapshot, RPC or privilege changes.
create or replace function public.reader_link_text_allowed(p_markdown text, p_at integer)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  line text; line_at integer := 1; line_end integer; previous_blank boolean := true;
  content_line text; content_base integer; indent integer; marker text; spacing integer;
  list_columns integer[] := '{}'; blank boolean; indented_code boolean := false; code_base integer := 0;
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
