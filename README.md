# Alpha Suite — BSMT 1-Alpha (Batch 28, PIT-COMED)

One app, one address: https://keanutugonon87-blip.github.io/alpha-suite/

- **Public page** (`#/`): class fund, past periods, standing board, officers, Facebook feed.
- **Officer app** (`#/staff`): Treasury (+QR scan, receipts, period close), Balances, Students, Watch (discipline ledger), Officers, Accounts and audit log.
- **Receipt check** (`#/receipt/<code>`): public verification page the receipt QR opens.

## Backend
Supabase project `gxwgkbplscsduscoeoph`. All tables are `v2_*` with row-level security; one Supabase Auth login for every role.
Old data lives in the `archive` schema (not exposed to the API).

## Develop
```
npm install
npm run build     # bundles src/app -> assets/build/*.js|css and writes index.html
```
Commit the build output; GitHub Pages serves the repo as-is. Hashed filenames mean browsers never serve stale code.
