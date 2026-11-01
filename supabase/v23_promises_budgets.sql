-- Alpha ’28 · v23 · Treasurer tools: payment promises and fund budgets.
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run.
--
--   • Promises: a student says "I will pay on Friday". The Mayor and Treasurer see promises due today and promises that were broken.
--   • Budgets: the Mayor and Treasurer set an amount for each fund. The Desk shows spent and what is left, and an expense that would go over the budget asks first.
-- Only the Mayor and Treasurer can read or change either one. Students and other officers cannot see them.

create table if not exists public.v2_promises (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.v2_members(id) on delete cascade,
  amount numeric not null check (amount > 0),
  promised_on date not null,
  note text check (note is null or char_length(note) <= 200),
  status text not null default 'open' check (status in ('open', 'kept', 'broken')),
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists v2_promises_member_idx on public.v2_promises (member_id);
create index if not exists v2_promises_due_idx on public.v2_promises (promised_on) where status = 'open';

create table if not exists public.v2_budgets (
  fund text primary key check (fund in ('class', 'sails', 'campus', 'batch')),
  amount numeric not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  updated_by_name text
);

alter table public.v2_promises enable row level security;
alter table public.v2_budgets enable row level security;
drop policy if exists promises_all on public.v2_promises;
create policy promises_all on public.v2_promises for all to authenticated
  using (public.v2_has_role('mayor', 'treasurer')) with check (public.v2_has_role('mayor', 'treasurer'));
drop policy if exists budgets_all on public.v2_budgets;
create policy budgets_all on public.v2_budgets for all to authenticated
  using (public.v2_has_role('mayor', 'treasurer')) with check (public.v2_has_role('mayor', 'treasurer'));
revoke all on public.v2_promises, public.v2_budgets from anon;

create or replace function public.v2_promise_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_by_name := coalesce((select p.full_name from public.v2_profiles p where p.user_id = auth.uid()), new.created_by_name); end if;
  if new.status <> 'open' and (tg_op = 'INSERT' or old.status = 'open') then new.closed_at := now(); end if;
  return new;
end $$;
drop trigger if exists v2_promise_stamp on public.v2_promises;
create trigger v2_promise_stamp before insert or update on public.v2_promises for each row execute function public.v2_promise_stamp();

create or replace function public.v2_budget_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by_name := coalesce((select p.full_name from public.v2_profiles p where p.user_id = auth.uid()), new.updated_by_name);
  return new;
end $$;
drop trigger if exists v2_budget_stamp on public.v2_budgets;
create trigger v2_budget_stamp before insert or update on public.v2_budgets for each row execute function public.v2_budget_stamp();

do $$ begin
  begin alter publication supabase_realtime add table public.v2_promises; exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.v2_budgets; exception when duplicate_object or undefined_object then null; end;
end $$;
