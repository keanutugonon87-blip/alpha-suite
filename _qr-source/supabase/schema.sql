-- =====================================================================
-- ALPHA TREASURY — QR Collection, Student Accounts & Digital Receipts
-- Supabase schema (Postgres + RLS)
-- =====================================================================
-- Run this in the Supabase SQL editor on your existing Alpha Treasury
-- project. Safe to run once; re-running will error on existing objects
-- (by design, so you don't accidentally wipe data — drop manually if
-- you need a clean re-run in a dev branch).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- 1. Roles helper — mirrors Alpha Watch's officer roles.
--    Adjust the mapping if your Alpha Watch role table already exists;
--    this just needs a way to tell "is this auth.uid() a Treasurer/Admin".
-- ---------------------------------------------------------------------
create table if not exists public.officer_roles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('mayor','vice_mayor','secretary',
                                              'treasurer','auditor','marshal',
                                              'sails_officer','admin')),
  full_name   text,
  created_at  timestamptz not null default now()
);

create or replace function public.is_treasurer_or_admin(uid uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.officer_roles
    where user_id = uid and role in ('treasurer','admin','mayor')
  );
$$;

-- ---------------------------------------------------------------------
-- 2. Students
--    One row per student, linked 1:1 to a Supabase Auth user.
--    Login is "student ID + password" — handled by mapping the student
--    ID to an internal synthetic email at signup time, e.g.
--    "2024-00123@students.alpha28.local" (see js/auth.js).
-- ---------------------------------------------------------------------
create table if not exists public.students (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid unique references auth.users(id) on delete set null,
  student_id         text unique not null,          -- e.g. "2024-00123"
  full_name          text not null,
  year_section       text,                            -- e.g. "BSMT 1-Alpha"
  enrollment_status  text not null default 'active'
                       check (enrollment_status in ('active','inactive','graduated','leave')),
  -- QR token bookkeeping (the token itself is signed server-side by the
  -- Edge Function and is NOT stored raw here — only its version/state).
  token_version      integer not null default 1,
  token_revoked      boolean not null default false,
  token_issued_at    timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_students_student_id on public.students(student_id);
create index if not exists idx_students_auth_user on public.students(auth_user_id);

-- ---------------------------------------------------------------------
-- 3. Dues configuration
--    Org-wide recurring due (per term), plus per-student overrides,
--    plus one-time dues/fees that are independent of the schedule.
-- ---------------------------------------------------------------------
create table if not exists public.dues_config (
  id             uuid primary key default gen_random_uuid(),
  term_label     text not null,                 -- e.g. "AY 2026-2027, 1st Sem"
  amount         numeric(10,2) not null,
  frequency      text not null check (frequency in ('weekly','monthly','per_term')),
  starts_on      date not null,
  ends_on        date,                            -- null = open-ended
  is_active      boolean not null default true,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

create table if not exists public.dues_overrides (
  id             uuid primary key default gen_random_uuid(),
  dues_config_id uuid not null references public.dues_config(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  override_type  text not null check (override_type in ('exempt','custom_amount')),
  custom_amount  numeric(10,2),                  -- required if override_type = custom_amount
  reason         text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  unique (dues_config_id, student_id)
);

create table if not exists public.one_time_dues (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,                  -- e.g. "Acquaintance Party fee"
  description    text,
  amount         numeric(10,2) not null,
  due_date       date,
  applies_to     text not null default 'all'      -- 'all' or 'selected'
                   check (applies_to in ('all','selected')),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

-- Which students a "selected"-scope one-time due applies to.
create table if not exists public.one_time_dues_targets (
  one_time_due_id uuid not null references public.one_time_dues(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  primary key (one_time_due_id, student_id)
);

-- ---------------------------------------------------------------------
-- 4. Dues instances (the actual "line items" a student owes)
--    Generated when a dues_config period rolls over, or when a
--    one_time_due is created. This is what "paid / pending / overdue"
--    is computed against.
-- ---------------------------------------------------------------------
create table if not exists public.dues_instances (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students(id) on delete cascade,
  source_type      text not null check (source_type in ('recurring','one_time')),
  dues_config_id   uuid references public.dues_config(id) on delete set null,
  one_time_due_id  uuid references public.one_time_dues(id) on delete set null,
  period_label     text,                          -- e.g. "September 2026"
  amount_due       numeric(10,2) not null,
  amount_paid      numeric(10,2) not null default 0,
  status           text not null default 'pending'
                     check (status in ('pending','partial','paid','overdue','exempt')),
  due_date         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_dues_instances_student on public.dues_instances(student_id);
create index if not exists idx_dues_instances_status on public.dues_instances(status);

-- ---------------------------------------------------------------------
-- 5. Transactions (collections)
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  receipt_number    text unique not null,          -- e.g. "AT-2026-000123"
  student_id        uuid not null references public.students(id),
  dues_instance_id  uuid references public.dues_instances(id),
  amount            numeric(10,2) not null,
  payment_mode      text not null check (payment_mode in ('cash','gcash')),
  gcash_reference   text,
  purpose           text not null,                 -- e.g. "September dues", "Event fee"
  remarks           text,
  transaction_type  text not null check (transaction_type in ('recurring','one_time')),
  collected_by      uuid not null references auth.users(id),
  collected_at      timestamptz not null default now()
);

create index if not exists idx_transactions_student on public.transactions(student_id);
create index if not exists idx_transactions_collected_at on public.transactions(collected_at desc);

-- Simple, safe receipt-number generator: AT-<year>-<zero-padded seq>
create sequence if not exists public.receipt_seq;
create or replace function public.next_receipt_number()
returns text language plpgsql as $$
declare
  n bigint;
begin
  n := nextval('public.receipt_seq');
  return 'AT-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 6, '0');
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Audit log
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users(id),
  action       text not null,                      -- e.g. "collect_payment", "reissue_qr"
  target_type  text,                                -- e.g. "student", "transaction"
  target_id    uuid,
  details      jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. Fund totals view (for the existing public transparency dashboard)
-- ---------------------------------------------------------------------
create or replace view public.fund_totals as
select
  coalesce(sum(amount), 0) as total_collected,
  count(*) as total_transactions
from public.transactions;

-- =====================================================================
-- 8. Row Level Security
-- =====================================================================
alter table public.students enable row level security;
alter table public.dues_config enable row level security;
alter table public.dues_overrides enable row level security;
alter table public.one_time_dues enable row level security;
alter table public.one_time_dues_targets enable row level security;
alter table public.dues_instances enable row level security;
alter table public.transactions enable row level security;
alter table public.audit_log enable row level security;
alter table public.officer_roles enable row level security;

-- officer_roles: officers can read the roster; only admins write (do this
-- manually via SQL editor / service role — no self-service role changes).
create policy officer_roles_select on public.officer_roles
  for select using (true);

-- students: a student can see their own row; treasurer/admin see all.
create policy students_self_select on public.students
  for select using (
    auth_user_id = auth.uid() or public.is_treasurer_or_admin(auth.uid())
  );
create policy students_admin_write on public.students
  for insert with check (public.is_treasurer_or_admin(auth.uid()));
create policy students_admin_update on public.students
  for update using (public.is_treasurer_or_admin(auth.uid()));

-- dues_config / one_time_dues: readable by all authenticated users
-- (students need to see what they owe), writable only by treasurer/admin.
create policy dues_config_read on public.dues_config
  for select using (auth.role() = 'authenticated');
create policy dues_config_write on public.dues_config
  for all using (public.is_treasurer_or_admin(auth.uid()))
  with check (public.is_treasurer_or_admin(auth.uid()));

create policy one_time_dues_read on public.one_time_dues
  for select using (auth.role() = 'authenticated');
create policy one_time_dues_write on public.one_time_dues
  for all using (public.is_treasurer_or_admin(auth.uid()))
  with check (public.is_treasurer_or_admin(auth.uid()));

create policy one_time_dues_targets_read on public.one_time_dues_targets
  for select using (auth.role() = 'authenticated');
create policy one_time_dues_targets_write on public.one_time_dues_targets
  for all using (public.is_treasurer_or_admin(auth.uid()))
  with check (public.is_treasurer_or_admin(auth.uid()));

create policy dues_overrides_read on public.dues_overrides
  for select using (public.is_treasurer_or_admin(auth.uid()));
create policy dues_overrides_write on public.dues_overrides
  for all using (public.is_treasurer_or_admin(auth.uid()))
  with check (public.is_treasurer_or_admin(auth.uid()));

-- dues_instances: student sees their own; treasurer/admin see + write all.
create policy dues_instances_self_select on public.dues_instances
  for select using (
    exists (select 1 from public.students s
            where s.id = dues_instances.student_id and s.auth_user_id = auth.uid())
    or public.is_treasurer_or_admin(auth.uid())
  );
create policy dues_instances_admin_write on public.dues_instances
  for all using (public.is_treasurer_or_admin(auth.uid()))
  with check (public.is_treasurer_or_admin(auth.uid()));

-- transactions: student sees their own; treasurer/admin see + write all.
-- Inserts/updates should really go through the Edge Function (service
-- role) so amounts can't be forged client-side, but these policies keep
-- direct client access sane as a fallback.
create policy transactions_self_select on public.transactions
  for select using (
    exists (select 1 from public.students s
            where s.id = transactions.student_id and s.auth_user_id = auth.uid())
    or public.is_treasurer_or_admin(auth.uid())
  );
create policy transactions_treasurer_write on public.transactions
  for insert with check (public.is_treasurer_or_admin(auth.uid()));

-- audit_log: officers only.
create policy audit_log_read on public.audit_log
  for select using (public.is_treasurer_or_admin(auth.uid()));
create policy audit_log_write on public.audit_log
  for insert with check (public.is_treasurer_or_admin(auth.uid()));

-- =====================================================================
-- 9. Secrets used by the Edge Function (set these via `supabase secrets set`,
--    never in client code):
--      QR_TOKEN_SECRET   — HMAC signing secret for student QR tokens
-- =====================================================================
