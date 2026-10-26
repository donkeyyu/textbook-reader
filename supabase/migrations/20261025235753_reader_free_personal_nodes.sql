-- Extend validation only; existing rows, RPC revisions and RLS stay in place.
create or replace function public.reader_valid_personal(p_content jsonb, p_pages integer)
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
      then return false; end if;
    if exists (select 1 from jsonb_each(item) pair where pair.key in ('chapterId', 'sectionId')
      and pair.value <> 'null'::jsonb and (jsonb_typeof(pair.value) <> 'string' or btrim(pair.value #>> '{}') = '')) then return false; end if;
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
