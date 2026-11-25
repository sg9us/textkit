create extension if not exists pgcrypto;

create table if not exists public.voc (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('bug', 'improvement', 'etc')),
  content text not null check (char_length(trim(content)) between 1 and 3000),
  author text not null check (char_length(trim(author)) between 1 and 40),
  status text not null default 'open' check (status in ('open', 'reviewing', 'done')),
  created_at timestamptz not null default now()
);

create index if not exists voc_created_at_idx on public.voc (created_at desc, id desc);
alter table public.voc enable row level security;
revoke all on public.voc from anon, authenticated;
grant select (id, type, content, author, status, created_at) on public.voc to anon, authenticated;
grant insert (type, content, author) on public.voc to anon, authenticated;

create policy "Public can read VOC" on public.voc
  for select to anon, authenticated using (true);
create policy "Public can submit open VOC" on public.voc
  for insert to anon, authenticated
  with check (status = 'open');
