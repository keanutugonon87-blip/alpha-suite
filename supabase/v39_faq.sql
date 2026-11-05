-- v39 · FAQ for the public student screen. The Secretary writes it; students read it (signed in or not).
-- Safe to run twice.

create table if not exists public.v2_faq (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(btrim(question)) between 3 and 200),
  answer text not null check (length(btrim(answer)) between 1 and 2000),
  topic text,
  sort int not null default 0,
  published boolean not null default true,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.v2_faq enable row level security;
drop policy if exists faq_read on public.v2_faq;
create policy faq_read on public.v2_faq for select to authenticated using (public.v2_is_staff());
drop policy if exists faq_write on public.v2_faq;
create policy faq_write on public.v2_faq for all to authenticated
  using (public.v2_has_role('secretary','mayor','vice_mayor')) with check (public.v2_has_role('secretary','mayor','vice_mayor'));
revoke all on public.v2_faq from anon;
grant select, insert, update, delete on public.v2_faq to authenticated;

-- Students and visitors read only what is published.
create or replace function public.v2_public_faq() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'question', question, 'answer', answer, 'topic', topic) order by sort, created_at), '[]'::jsonb)
  from public.v2_faq where published;
$$;
grant execute on function public.v2_public_faq() to anon, authenticated;

-- A starting set, written in plain words. The Secretary edits or removes them in the FAQ pane.
insert into public.v2_faq(question, answer, topic, sort)
select * from (values
  ('How do I sign in?', 'Use your Student ID and your 6-digit PIN. If this is your first time, scan your QR card first and then set a PIN.', 'Account', 1),
  ('I forgot my PIN. What do I do?', 'Ask the Treasurer or the Mayor to reset it. You will sign in with your QR card and choose a new PIN.', 'Account', 2),
  ('How do I pay my dues or fines?', 'Pay the Treasurer in cash or by GCash. You get a receipt for every payment, and your balance updates right away.', 'Payments', 3),
  ('Where can I see what I owe?', 'Open the Me tab after signing in. It shows what you owe, what you paid and your receipts.', 'Payments', 4),
  ('How can I ask for a class record?', 'Open the Archive tab and send a request. The Secretary answers within a reasonable time, and only non-confidential records can be shared.', 'Records', 5),
  ('Who can see my personal information?', 'Only the officers who need it for their work. Open the Privacy tab to read how your data is handled.', 'Privacy', 6),
  ('How do I file an excuse letter?', 'Give it to the Marshal or the Secretary. They attach it to the record, and the Mayor reviews it.', 'Attendance', 7)
) as v(question, answer, topic, sort)
where not exists (select 1 from public.v2_faq);
