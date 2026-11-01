-- Draft deployment input, not applied. Separate from the mutable reader_books row.
begin;
create table if not exists public.reader_initial_versions (
  textbook text not null check (textbook ~ '^[a-f0-9]{64}$'),
  version text not null check (version ~ '^[a-f0-9]{64}$'),
  package jsonb not null check (jsonb_typeof(package) = 'object'),
  archived_at timestamptz not null default now(),
  primary key (textbook, version),
  check (package @> jsonb_build_object('textbook', textbook, 'version', version))
);
alter table public.reader_initial_versions enable row level security;
revoke all on public.reader_initial_versions from public, anon, authenticated, service_role;
grant select on public.reader_initial_versions to anon, authenticated;
grant select, insert on public.reader_initial_versions to service_role;
drop policy if exists reader_initial_versions_read on public.reader_initial_versions;
create policy reader_initial_versions_read on public.reader_initial_versions for select to anon, authenticated using (true);
-- A separate publisher can only insert. No client can update or delete history.
create or replace function public.reader_initial_version_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Initial versions are immutable';
end;
$$;
revoke all on function public.reader_initial_version_immutable() from public, anon, authenticated;
drop trigger if exists reader_initial_version_immutable on public.reader_initial_versions;
create trigger reader_initial_version_immutable before update or delete on public.reader_initial_versions
for each statement execute function public.reader_initial_version_immutable();
commit;
