# DAC Booking Form Portal

Digitises the DAC Developers paper **Booking Form** (page 1) and **Terms & Conditions for
Provisional Allotment** (page 2), with supporting-document upload and a sequential
nine-step signature workflow.

**Status: Phase 5 of 8 complete.**

* **Phase 1** — project setup, data model, authentication, RBAC, app shell, admin project CRUD.
* **Phase 2** — the digital booking form: all paper fields in order, the boxed character
  inputs, shared Zod validation, debounced autosave, and the My Forms list.
* **Phase 3** — supporting documents: the data-driven checklist, direct signed-URL upload,
  client-side image compression, replace/remove, audited views, and the photo boxes wired
  to the uploaded photographs.
* **Phase 4** — the T&C page and versioning, the submit gate, Booking ID allocation, the
  flow engine, and the booking status timeline.
* **Phase 5** — the signatory portal, signature capture, in-person applicant capture with
  witness, the Co-ordinator's validate step, and return/resume.

See `PLAN.md` §10 for the full phase plan. Next: Phase 6, PDF generation.

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

#### If connections hang instead of failing

Check `server.log` for:

```
LOG:  could not reserve shared memory region (addr=...) for child ...: error code 487
```

The postmaster is alive and `pg_ctl status` reports "server is running", but it cannot
fork a single backend, so every connection — `psql` included — hangs rather than
erroring. On Windows this is an address-space collision on the shared memory segment,
usually antivirus or another injected DLL landing where the postmaster wants to map it.

Restarting clears it. `shared_buffers` is set to **32MB** and `max_connections` to **30**
in this cluster (defaults were 128MB/100) because a smaller segment is markedly easier to
place; the original file is kept as `postgresql.conf.bak`. Those values are ample for
development and are irrelevant to production, which is Supabase.

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
* **`src/proxy.ts` must stay a cookie-presence check only.** (Next 16 renamed
  `middleware.ts` → `proxy.ts`.) Vercel deploys Routing Middleware to *all* regions
  regardless of the `regions` setting, so anything there may run outside India. Whether the
  renamed Node-runtime proxy still does is unconfirmed — **Phase 8 must verify the actual
  region in Vercel's function logs.** Until then: no DB reads, no session decryption, no
  personal data. The file carries this warning in a header comment — please leave it there.
* No third-party analytics or error tracker receives personal data. PAN and Aadhaar are
  redacted from audit payloads and logs by `src/lib/audit/redact.ts`, which is unit tested.

## The booking form (Phase 2)

`/forms` → **New booking form** → creates a draft → `/forms/{id}/edit`.

* **Autosave** is debounced at 1.2 s; the header shows *"All changes saved at HH:MM:SS"*.
  Navigating away with an unsaved change triggers the browser's confirm prompt.
* **`<BoxInput>`** renders the printed character squares and is used at four lengths —
  mobile 10, alternate mobile 10, Adhaar 12, D.O.B 8 (as four visual pairs). Auto-advance,
  backspace steps back, arrow keys move, and pasting a whole number fills from the caret.
* **Validation lives in `src/lib/validation/booking-form.ts`** and is shared by client and
  server. Two levels on purpose: `draftSchema` accepts anything half-typed, `submitSchema`
  is the real gate (Phase 4). The server always re-parses; the client copy is convenience.
* **Aadhaar uses the Verhoeff checksum**, not just a length test — it catches the adjacent
  transposition a hand-typed card invites. PAN accepts company and HUF holder types, not
  just individual.
* **PAN and Aadhaar are encrypted as soon as they are valid**, and are **not decrypted back
  into the editor**. Reopening a draft shows those two boxes blank by design; re-enter to
  change them. Every other field repopulates.
* Money is parsed to **BigInt paise** on the way in and never touches a float.

## Supporting documents (Phase 3)

`/forms/{id}/documents`, also linked from the editor header and the My Forms list.

* **The checklist is data, not code.** Rows come from `document_types`, and whether each
  is mandatory from `document_requirements` — so DAC can change the attachment list
  without a deploy. Second-applicant rows are *hidden*, not merely optional, until a
  second applicant exists.
* **Storage is a swappable driver** (`src/lib/storage/`). With no credential configured
  the app writes to the local filesystem (`../dac-storage`, outside the repository), so
  development needs no cloud account. Setting `SUPABASE_SERVICE_ROLE_KEY` switches it to
  Supabase Storage — there is nothing else to change. See `.env.example`.
* **Uploads go direct to storage** against a short-lived HMAC-signed *grant* that names
  the key, the content type and the size ceiling. The `form_documents` row is written
  only after the server confirms the object actually landed, at the expected size — a row
  that claims a PAN card is on file when it is not would be worse than no row at all.
* **Images are downscaled in the browser** before upload (longest edge 1600px, JPEG q0.82).
  A phone photo of an Aadhaar card goes from ~5 MB to a few hundred KB. PDFs pass through
  untouched, and any failure falls back to the original file.
* **Reads go through `/api/documents/{id}`**, which authorises, audits, then redirects to a
  signed URL valid for 60 seconds. There is no code path that produces a public URL.
  Photo boxes use a plain `<img>`, never `next/image` — the optimiser would cache those
  bytes on a CDN outside India.
* **Region is enforced, not assumed.** The Supabase driver refuses to start in production
  unless the project region is `ap-south-1`, and `/api/health` reports the live driver and
  its residency so a misconfigured deploy is visible rather than silent.

`npx tsx --conditions=react-server scripts/verify-storage.ts` exercises the whole pipeline
against the real database and the configured driver, then cleans up after itself.

## Submit and the signature flow (Phase 4)

`/forms/{id}` is the booking's status page; `/forms/{id}/review` is where it gets submitted.

* **The submit gate reports everything at once.** Submitting is irreversible, so the gate
  lists every outstanding field *and* every missing mandatory document, grouped and ordered
  as the paper form prints them, rather than surfacing one error per attempt. It validates
  what is **in the database**, not what the browser sent — the creator may be submitting
  from a tab opened yesterday.
* **PAN and Aadhaar are never decrypted to validate them.** They were checked when they
  were written, so the gate reads the stored last-4 as proof. See `storedSubmitSchema`.
* **Booking IDs are `DAC/YYYY/NNNNN`**, allocated at submit inside the transaction via
  `INSERT … ON CONFLICT … DO UPDATE` on `booking_sequences`. Gap-free: eight concurrent
  submits get eight consecutive numbers, and a rolled-back submit consumes none. The year
  is the **IST** year, so a booking taken at 01:00 on 1 January files under the new year.
* **The pipeline is planned, not hard-coded.** `src/lib/flow/plan.ts` is pure and decides
  which step is open, which are skipped and where a returned form resumes;
  `src/lib/flow/engine.ts` only writes what it decides.
* **A returned form resumes at the step that returned it**, not at step 1 — re-collecting
  eight signatures for a typo would make the feature unusable. Signatures behind the resume
  point are never touched.
* **One case rewinds further.** If a second applicant is *added* while the form is back with
  the creator, step 2 was skipped and is now needed, so the flow rewinds to it and the
  approvals that came after are re-opened. Resuming at the return point would send a booking
  onward with an unsigned second applicant.
* **`SUBMITTED` vs `IN_REVIEW`:** `SUBMITTED` means in the pipeline with nothing signed yet;
  `IN_REVIEW` starts at the first signature (Phase 5). The state diagram in `PLAN.md` §7
  shows them as one transition; giving each an observable meaning is more useful.
* **T&C are versioned and hashed.** Each form stores the version id it was accepted under,
  and `/forms/{id}/terms` renders that exact text with its SHA-256. A correction makes a new
  version; a referenced row is never edited.

> **v1 of the T&C is not approved.** It was transcribed from a photograph. Production refuses
> to submit against an unapproved version; development falls back to it so the flow is
> testable before legal sign-off. Approve it by setting `tnc_versions.is_approved` once
> `content/terms/v1.md` § REVIEW CHECKLIST is signed off.

### Development helpers

```bash
# A complete draft that passes the gate, printed with its URLs.
npx tsx --conditions=react-server scripts/dev-fixture.ts          # add --empty or --joint

# End-to-end checks against the real database; both clean up after themselves.
npx tsx --conditions=react-server scripts/verify-submit.ts
npx tsx --conditions=react-server scripts/verify-storage.ts

# A session cookie for curl, for a seeded .test account.
npx tsx scripts/dev-session.ts exec@dac.test
```

`--conditions=react-server` is needed because these scripts import modules marked
`server-only`, whose default entry point throws outside a React Server Component.

## Signing (Phase 5)

Signatories land on `/signatory/queue`, the Co-ordinator on `/coordinator/queue`, and both
lead to `/forms/{id}/sign/{step}` — one screen for all nine steps, because the decision is
always the same: read the booking, then sign it or send it back. What differs comes from the
`flow_steps` row, so a tenth step needs no new page.

* **Signing is personal — there is no admin override.** An admin can rescue, view and
  reassign, but letting them sign as somebody else would put a name on a legal document that
  never agreed to it, and make the audit trail a record of who clicked rather than who
  approved.
* **Staff steps are claimed, not pre-assigned.** Any active holder of the step's role can
  pick a booking up; the first to act claims it. Pinning each step to one named person would
  stall every booking behind one absence.
* **A signatory sees a booking only while it is waiting on them**, or afterwards if they
  signed it. Before their turn it does not exist as far as they are concerned, and denials
  are 404 so they cannot find out by probing.
* **Applicant steps are captured in person.** Steps 1 and 2 are assigned to the creator, who
  hands over the tablet. The applicant types their name and signs; the name is stored on the
  signature and the creator is recorded as **witness**. Applicants have no login, so the
  typed name is the only record of who signed.
* **The Co-ordinator's step is `VALIDATE_AND_SIGN`** and lands on `VALIDATED`, not `SIGNED`,
  so the one step that asserts the form was *checked* stays distinguishable. Signing without
  ticking the box is refused server-side.
* **Returning needs a reason.** The comment is mandatory (10 characters minimum, enforced on
  the server) because it is the only thing the creator sees. Signatures already collected
  survive, and the booking comes back to the step that sent it away.
* **`SUBMITTED` → `IN_REVIEW`** on the first signature; **`COMPLETED`** when the last
  applicable step is signed, which the pipeline configuration decides rather than a hard-coded
  "the CRM is last".
* **The signature image goes to storage before the database transaction.** A storage write
  cannot join a Postgres transaction, so this order can leave an unreferenced object behind —
  recoverable and invisible. The reverse would leave a step marked SIGNED pointing at bytes
  that were never stored: a booking that looks approved and cannot be printed. Orphans are
  cleaned up on a rollback or a lost race.
* **The pad is validated, not trusted.** The server checks the PNG magic number rather than
  the declared `data:image/png` type, caps the size, and rejects an implausibly small image.
  The browser also disables the button until a stroke exists; neither check is sufficient
  alone.
* Signature images are served by `/api/signatures/{id}` — authorise, then redirect to a
  60-second signed URL — and rendered with a plain `<img>`, never `next/image`, whose
  optimiser would cache them on a CDN outside India.

```bash
# 36 checks: all nine steps, the return, the resume, and that the queue query
# agrees with canActOnStep. Cleans up its bookings and signature objects.
npx tsx --conditions=react-server scripts/verify-sign.ts
```

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
