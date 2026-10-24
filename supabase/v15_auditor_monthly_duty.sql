-- v15: one extra duty for the Auditor, once a month. Safe to run twice (it skips if the duty already exists).
insert into public.v2_duty_templates(role, title, detail, repeat, days, month_day, sort)
select 'auditor', 'Monthly system check', 'Open System: backup check passed, no problems listed, SQL files all run. Then compare the cash count with the app before the month is closed.', 'monthly', null::int[], 1, 30
where not exists (select 1 from public.v2_duty_templates where role = 'auditor' and title = 'Monthly system check');
