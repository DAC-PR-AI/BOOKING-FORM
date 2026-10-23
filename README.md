# DAC Booking Form Portal

Digitises the DAC Developers paper **Booking Form** (page 1) and **Terms & Conditions for
Provisional Allotment** (page 2), with supporting-document upload and a sequential
nine-step signature workflow.

**Status: Phase 1 of 8 complete** — project setup, data model, authentication, RBAC, app
shell, admin project CRUD. See `PLAN.md` §10 for the full phase plan.

| Document | What's in it |
|---|---|
| `PLAN.md` | Architecture, stack rationale, ER + flow diagrams, phases, risks |
| `FIELD_MAP.md` | Every paper field → DB column → input type → validation |
| `FILL_LIST.md` | Every blank on the paper, as a person fills it (67 items) |
| `OPEN_QUESTIONS.md` | Decisions taken and still outstanding |
| `content/terms/v1.md` | Transcribed T&C — **pending DAC legal review** |

---

## Prerequisites

* **Node.js ≥ 20.9** (developed on 24.x)
* **PostgreSQL 16+** for local development (production is Supabase, Mumbai)

## Setup

```bash
npm install
cp .env.example .env          # then fill it in — see below
createdb dac_booking          # or: CREATE DATABASE dac_booking;
npm run db:migrate            # create the schema
npm run db:seed               # roles, demo users, document types, flow, T&C v1
npm run dev                   # http://localhost:3000
```

### The local development cluster

This machine already had PostgreSQL 18 on port **5432** with a password we did not
have, so development runs against a **separate cluster on port 5433** that was created
for this project. The original 5432 server is untouched.

| | |
|---|---|
| Data directory | `D:\OCT-2026\pgdata-dac` |
| Port | **5433** |
| Auth | `trust`, bound to `localhost` only — **development only, never production** |
| Log | `D:\OCT-2026\pgdata-dac\server.log` |

It is **not** a Windows service, so it does not start automatically after a reboot:

```powershell
$bin  = 'C:\Program Files\PostgreSQL\18\bin'
$data = 'D:\OCT-2026\pgdata-dac'

& "$bin\pg_ctl.exe" -D $data -l "$data\server.log" start   # start
& "$bin\pg_ctl.exe" -D $data status                        # check
& "$bin\pg_ctl.exe" -D $data stop                          # stop
```

If `npm run dev` reports it cannot reach the database, this server is almost certainly
not running. To use your own PostgreSQL on 5432 instead, just point `DATABASE_URL` at it
and re-run `npm run db:migrate && npm run db:seed`.

### Generating the two keys

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run it twice — once for `FIELD_ENCRYPTION_KEY`, once for `SESSION_SECRET`.

> **`FIELD_ENCRYPTION_KEY` encrypts PAN and Aadhaar at rest.** Changing it makes every
> stored PAN and Aadhaar permanently unreadable. Back it up somewhere safe and separate
> from the database. Rotating `SESSION_SECRET` is harmless — it just signs everybody out.

## Demo accounts

Created by `npm run db:seed`. Password `DacDev!2026` (override with `SEED_PASSWORD`).
All on `.test`, which cannot receive real email. The seed refuses to run with
`NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=yes`.

| Email | Role | Lands on |
|---|---|---|
| `admin@dac.test` | Admin | `/admin/users` |
| `exec@dac.test` | Sales Executive | `/forms` |
| `agm@dac.test` | AGM | `/signatory/queue` |
| `gm@dac.test` | DGM / GM | `/signatory/queue` |
| `vpsales@dac.test` | VP Sales | `/signatory/queue` |
| `coordinator@dac.test` | Sales Co-ordinator | `/coordinator/queue` |
| `mis@dac.test` | MIS | `/signatory/queue` |
| `director@dac.test` | Director | `/signatory/queue` |
| `crm@dac.test` | CRM | `/signatory/queue` |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | `prisma generate` + production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run db:migrate` | Create/apply a migration (dev) |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Seed reference data |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | **Drops and recreates the database**, then re-seeds |

---

## Changing the signature flow

The pipeline is **data, not code** — order, roles and actions live in `flow_steps`. Adding
a step needs no deploy.

Current pipeline (brief §5.1):

| # | Step | Role | Action |
|---|---|---|---|
| 1 | 1st Applicant | Sales Executive* | SIGN |
| 2 | 2nd Applicant | Sales Executive* | SIGN — skipped when there is no second applicant |
| 3 | AGM | AGM | SIGN |
| 4 | DGM / GM | DGM / GM | SIGN |
| 5 | VP Sales | VP Sales | SIGN |
| 6 | **Sales Co-ordinator** | Sales Co-ordinator | **VALIDATE + SIGN** |
| 7 | MIS | MIS | SIGN |
| 8 | Director | Director | SIGN |
| 9 | CRM | CRM | SIGN — signing here completes the booking |

\* Applicants have no login. Their steps carry `actsOnCreatorDevice = true`: the form's
creator hands over their tablet, the applicant draws their signature, and the creator is
recorded as **witness**.

**Managing Director** (page 1) and **Authorized Signatory** (page 2) are deliberately *not*
in the flow — they render as blank print-ready lines for wet signing after download.

To change the order, edit `FLOW_STEPS` in `prisma/seed.ts` and re-run `npm run db:seed`,
or edit the `flow_steps` rows directly. Changes apply to **new** forms; forms already in
flight keep the pipeline they started with, because each one has its own
`form_step_records`.

---

## Data residency — read before deploying

All personal data must physically reside in **India**.

* **Supabase project region must be `ap-south-1` (Mumbai).** Verify at creation; it cannot
  be changed afterwards.
* **Vercel functions are pinned to `bom1`** in `vercel.json`.
* **`src/middleware.ts` must stay a cookie-presence check only.** Vercel deploys Routing
  Middleware to *all* regions regardless of the `regions` setting, so anything there may
  run outside India. No DB reads, no session decryption, no personal data. The file carries
  this warning in a header comment — please leave it there.
* No third-party analytics or error tracker receives personal data. PAN and Aadhaar are
  redacted from audit payloads and logs by `src/lib/audit/redact.ts`, which is unit tested.

## Security notes

* Passwords: **Argon2id** (`@node-rs/argon2`), m=19456 t=2 p=1, per OWASP.
* Sessions: opaque 256-bit tokens, **SHA-256 hashed in the database**, HMAC-signed cookie,
  `httpOnly` + `sameSite=lax` + `secure` in production, 12-hour expiry. Revocable — an
  admin deactivating a user kills their sessions immediately.
* Login throttling: 5 failed attempts → 15-minute lockout. One generic error message, so
  staff email addresses cannot be enumerated.
* Authorisation is server-side in every Server Action and Route Handler. Denials return
  **404, not 403**, so a signatory cannot learn that a booking exists.
* PAN and Aadhaar are **AES-256-GCM encrypted** at rest with a separate last-4 column for
  lists.

## Before production

* **Vercel Hobby is non-commercial use only** → move to **Pro**.
* **Supabase Free has no backups and pauses after ~7 days idle** → move to **Pro**.
  (A daily cron hits `/api/health` to defeat the pause meanwhile.)
* **`content/terms/v1.md` is transcribed from a photograph and not yet approved.** Its
  review checklist must be signed off, and `tnc_versions.is_approved` set, before any real
  customer signs.
