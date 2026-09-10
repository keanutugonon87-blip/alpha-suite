# Alpha Treasury — QR Collection, Student Accounts & Digital Receipts

Extension to Alpha Treasury adding: student self-service accounts, a signed
per-student QR token, a Treasurer-side camera scan-and-collect flow, dues
configuration (recurring + one-time), auto-generated PDF receipts, and a
login-gated student dashboard. Everything syncs through your existing
Supabase project.

## 1. Deploy the database schema

In the Supabase SQL editor, run `supabase/schema.sql`. It's additive — it
creates new tables (`students`, `dues_config`, `dues_overrides`,
`one_time_dues`, `dues_instances`, `transactions`, `audit_log`,
`officer_roles`) and won't touch your existing Alpha Watch tables.

If you already track officer roles somewhere in Alpha Watch, either:
- point `is_treasurer_or_admin()` at your existing table instead of the
  new `officer_roles` table, or
- populate `officer_roles` once from your current roster:
  ```sql
  insert into officer_roles (user_id, role, full_name) values
    ('<auth-uid-of-treasurer>', 'treasurer', 'Kirby Abragan'),
    ('<auth-uid-of-mayor>', 'mayor', 'Keanu Tugonon');
  ```
  (Get each officer's `auth.users.id` from Supabase Auth → Users, after
  they've each signed in once via `pages/officer-login.html`.)

## 2. Deploy the Edge Function

The QR token is signed with an HMAC secret that must **never** reach the
browser. This lives in a Supabase Edge Function.

```bash
supabase functions deploy qr-token
supabase secrets set QR_TOKEN_SECRET=$(openssl rand -hex 32)
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically
to Edge Functions in your project — you don't need to set them yourself.

## 3. Configure the frontend

In `js/supabase-client.js`, set:
```js
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
```
Both values are safe to expose publicly (that's what "anon" means) —
find them in Supabase → Project Settings → API.

In `js/receipt.js`, set `DASHBOARD_BASE_URL` to wherever
`student-dashboard.html` will actually be hosted (e.g. your GitHub Pages
URL), so the QR code printed on receipts links somewhere real.

## 4. Seed the student roster

Before students can self-signup, a Treasurer/Admin needs a `students` row
for each of them (name, student ID, section) with `auth_user_id` left
null. The simplest way for a class of ~40-60 is a one-time SQL insert or
CSV import in the Supabase table editor:

```sql
insert into students (student_id, full_name, year_section) values
  ('2024-00123', 'Juan Dela Cruz', 'BSMT 1-Alpha'),
  ('2024-00124', 'Maria Santos', 'BSMT 1-Alpha');
  -- ...
```

Each student then visits `pages/student-login.html` → "Set up your
account", enters their Student ID + a password, and their auth account
gets linked to the pre-seeded row. Their QR token is generated the first
time they load the dashboard (`my_token` action) — no separate signing
step needed on your end.

**Why self-signup instead of admin-created accounts:** creating *other
users'* Supabase Auth accounts requires the service-role key, which can't
safely live in browser JS. If you'd rather have the Treasurer truly
bulk-create accounts with preset temporary passwords, add a
`create-student` Edge Function modeled on `qr-token`, using
`supabase.auth.admin.createUser()` server-side — say the word and it can
be added the same way.

## 5. Wire up the pages

Everything lives under `pages/`, linked to each other by relative path —
deploy the whole `pages/` + `js/` tree together (e.g. as a folder inside
your existing GitHub Pages site, alongside Alpha Watch/Treasury).

| Page | Who | What |
|---|---|---|
| `student-login.html` | Students | Sign in / one-time account setup |
| `student-dashboard.html` | Students | Own QR, dues status, history, receipts |
| `officer-login.html` | Treasurer/Admin | Shared officer sign-in |
| `treasurer-home.html` | Treasurer/Admin | Fund overview + navigation |
| `treasurer-collect.html` | Treasurer | Scan QR → confirm → log payment → receipt |
| `admin-dues.html` | Treasurer/Admin | Recurring dues, overrides, one-time fees |
| `admin-bulk-qr.html` | Treasurer/Admin | Bulk-issue tokens, export CSV/printable sheet |

To integrate into the existing Alpha Watch shell (rather than as
standalone pages), lift the `<script type="module">` bodies into your
IIFE-module Treasury bundle the same way Treasury was folded into Alpha
Watch — the imports are plain ES modules and don't assume they're the
only script on the page.

## 6. Recurring dues housekeeping (run periodically)

Two things should run on a schedule rather than only when someone happens
to click a button:

- **Generate this period's dues** — `admin-dues.html` has a manual
  "Generate" button. For real automation, wrap
  `generateRecurringInstancesForPeriod()` (in `js/dues.js`) in a
  Supabase cron job (Supabase → Database → Cron, or a scheduled Edge
  Function) that runs monthly/weekly per `dues_config.frequency`.
- **Mark overdue instances** — `sweepOverdueInstances()` currently runs
  opportunistically when a student loads their dashboard. For accuracy
  even when nobody logs in, put this on the same cron schedule.

## 7. Security notes

- The QR token is an HMAC-signed payload (`{student_id, token_version,
  issued_at}` + signature), verified server-side in the Edge Function.
  It is **not** just the student's raw ID — a photo of someone's ID
  number alone can't forge a working QR.
- Reissuing a QR (`reissue` action) bumps `token_version`, which
  immediately invalidates every previously printed/downloaded copy of
  that student's QR — use this if a QR is lost or suspected compromised.
- All money-moving writes (`collect` action) happen inside the Edge
  Function using the service-role key, after re-verifying the token
  server-side — the browser never has a path to write a transaction
  directly with an arbitrary amount.
- Row Level Security is enabled on every new table; students can only
  read their own `students` / `dues_instances` / `transactions` rows;
  officers (per `officer_roles`) can read/write everything relevant to
  their role.

## 8. Known follow-ups worth doing before wide rollout

- Add a `create-student` Edge Function (see §4) if you want true admin
  bulk-account creation instead of student self-signup.
- The bulk QR export currently issues tokens sequentially, one request
  per student — fine for ~40-60 students, worth batching if the roster
  grows much larger.
- Consider a shorter session timeout specifically on the Collect page,
  since it's the one page that moves money.
