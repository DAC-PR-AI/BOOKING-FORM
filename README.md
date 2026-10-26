# DAC Booking Form Portal

Digitises the DAC Developers paper **Booking Form** (page 1) and **Terms & Conditions for
Provisional Allotment** (page 2), with supporting-document upload and a sequential
nine-step signature workflow.

**Status: Phase 8 of 8 complete — ready to deploy.**

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
* **Phase 6** — PDF generation: both pages of the paper form, write-once with a SHA-256,
  and an automated fidelity check.
* **Phase 7** — notifications and the nightly digest, the audit viewer, the free-tier
  meters, and the Google Sheet project sync.
* **Phase 8** — hardening: a Content-Security-Policy, the login timing oracle closed, error
  boundaries, 26 end-to-end tests in a real browser, and a clean production build.

See `PLAN.md` §10 for the full phase plan. What remains is **configuration, not code** — see
*Before production* at the foot of this file.

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
| `npm test` | Vitest unit tests (516) |
| `npm run test:e2e` | Playwright, in a real browser (26) |
| `npm run fixture` | A complete booking to click through (`-- --joint --complete`) |
| `npm run dev:clean` | Delete test bookings and their files |
| `npm run verify:storage` | Storage round trip, against the real driver |
| `npm run verify:submit` | The submit gate, Booking IDs, the flow engine |
| `npm run verify:sign` | All nine signatures, the return, the resume |
| `npm run verify:pdf` | PDF generation and the 61-label fidelity check |
| `npm run verify:notify` | Who gets told, and what notifications may carry |
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

`npm run verify:storage` exercises the whole pipeline
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
npm run fixture --          # add --empty or --joint

# End-to-end checks against the real database; both clean up after themselves.
npm run verify:submit
npm run verify:storage

# A session cookie for curl, for a seeded .test account.
npm run dev:session -- exec@dac.test
```

Each runs with `scripts/tsconfig.json`, which maps `server-only` to a no-op. The scripts
import application modules that carry that guard, and its real package throws unless Node
resolves under the `react-server` condition — but `@react-pdf/renderer` needs the ordinary
React build and breaks under exactly that condition. The two cannot both be satisfied in one
plain Node process, so the guard is stubbed for scripts only; the application's own tsconfig
is untouched.

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
npm run verify:sign
```

## The PDF (Phase 6)

`/forms/{id}/pdf`, linked from the booking page once every signature is in.

* **Both pages, reproduced rather than redesigned**: the header block, the grey section
  ribbons, the character boxes, the tick squares, the photo boxes, the signature grid, the
  note printed sideways up the left margin, and page 2's terms with its three signature
  labels.
* **Write-once.** A booking produces exactly one PDF, at completion, and later requests
  serve those same bytes. That is the point of the SHA-256 stored beside it — a hash is
  worth nothing if the document behind it can quietly change when a layout is tweaked or a
  project renamed.
* **It carries PAN and Aadhaar in full.** The brief's masking rule is about *lists*; this is
  the booking form itself, and the paper original has both numbers written across its boxes.
  A masked PDF would be a different document. The decrypt happens in one place
  (`src/lib/pdf/data.ts`), is audited as `VIEW_SENSITIVE` alongside the `PDF` entry, and the
  output lands in the same private India-resident storage the ciphertext already lives in.
* **One geometry source.** `src/lib/pdf/form-layout.ts` owns the proportions, box counts and
  signature-slot mapping. react-pdf is a separate layout engine from the browser (PLAN.md
  §4), so the sheet is authored twice; this is what stops the two drifting, and what keeps
  the documented Chromium fallback a renderer swap rather than a rewrite.
* **The Sales Co-ordinator cell is appended, not squeezed in.** The paper prints eight
  signature cells; the pipeline has nine steps (OPEN_QUESTIONS Q5). Managing Director (page
  1) and Authorized Signatory (page 2) stay blank rules for wet signing after download (Q7).

### Checking fidelity

The real gate is holding a print against the photograph — a human judgement. What is
automated is the part a machine can repeat:

```bash
npm run verify:pdf -- --keep ./booking-form.pdf   # 24 checks, then writes a copy to look at
npm run pdf:sample -- ./sample.pdf                # no database; seconds, for layout work
```

`npm run verify:pdf` builds a booking, signs all nine steps, generates the PDF and then reads
the text back out of it (`src/lib/pdf/extract-text.ts`) to assert that all **61 printed
labels** are present, in the order the paper prints them, along with the booking's values,
the full PAN and Aadhaar, and the ticked options. A dropped ribbon or a section rendered in
the wrong place fails the run instead of being noticed months later.

**Brand assets** live in `public/brand/` and are read at render time, so replacing one needs
no code change and no restart. `dac-logo.png` is in place; the header box is sized from the
artwork's own aspect ratio (`LOGO` in `form-layout.ts`), so a differently shaped replacement
is a one-line change and is never stretched. With no file present the header falls back to
the wordmark as type with a visible "logo placeholder" note, so a missing asset is obvious
rather than silently blank. The corner banners are drawn as shapes and need no artwork.

## Notifications, audit and the project sheet (Phase 7)

* **The in-app queue is the system of record.** `/notifications`, with an unread count in the
  header. Email is a best-effort digest layered on top, because Resend's free tier allows
  **100 messages a day** — not 3,000 a month as the monthly figure suggests — and one email
  per signature would run out at about eleven bookings.
* **Notifications are dispatched after the transaction commits, never inside it.** A
  signature that is safely recorded but unannounced is recoverable; a signature rolled back
  because a notification failed is not. Every dispatch swallows and logs its own errors.
* **A step that opens reaches every active holder of its role**, because the step is
  unassigned until somebody claims it — telling one named person would be telling the wrong
  person half the time. Applicant steps go to the creator, who performs the capture.
* **Nothing downstream is told before its turn**, and the person who returns a booking is not
  notified about their own action.
* **No notification carries a PAN or Aadhaar.** They reach email, which leaves India, so
  this is asserted in both the unit tests and the verification run.

`/admin/audit` is a reader over the append-only trail, filterable by group and searchable by
booking, person or detail. PAN and Aadhaar never reach those rows — `redact()` strips them on
the way in — so the whole payload is safe to show.

### The project sheet (PLAN.md §2A)

`Admin → Projects` has a **Preview** and a **Sync now**, plus a daily cron at 08:00 IST.

* **The booking form reads Postgres, never Google.** If the sheet is unavailable, staff lose
  access to *new* project names — not the ability to book, and not any existing booking's
  project.
* **Upsert by a stable code, never by name.** Keyed on the name, fixing a typo in the sheet
  silently creates a duplicate project and splits the reporting; keyed on a code, the same
  edit is a rename. If the sheet has no code column one is derived and the admin screen says
  so, because derived codes reintroduce exactly that problem.
* **A project that disappears from the sheet is deactivated, never deleted** — a booking from
  six months ago must still resolve its project name. Projects added by hand have no code and
  are left strictly alone.
* **Preview exists because a sync can hide projects.** It runs the same plan and writes
  nothing, so an admin sees what would change before committing to it.
* Reading the sheet is about sixty lines of JWT and `fetch` (`src/lib/google/sheets.ts`)
  rather than the `googleapis` package, which is tens of megabytes for two HTTP calls on a
  platform with a bundle size limit. Read-only scope.

Unconfigured, the sync reports itself as not configured and everything else works — see
`.env.example` for the four variables and the expected columns.

### The nightly digest

One email per person per night, listing what they have not read — never one per event.
Resend's free tier is 3,000 a month but **capped at 100 a day**, and the day is the binding
limit: per-event sending runs out at about eleven bookings.

* Only **unread** notifications are emailed; a reminder about something already seen is noise.
* Only ones **not emailed before**, so a notification left unread for a week produces one
  email, not seven.
* The budget is counted from what was actually sent today, because a manual run and the cron
  share the same 100.
* When the cap is reached, people are **deferred, not dropped** — longest-waiting first, so a
  capped night never starves the same person twice.
* `.test` addresses are skipped. The seeded demo accounts are all on `.test`, which is
  reserved so it never resolves; sending to them would burn the budget on guaranteed bounces.

Unconfigured, the digest reports itself as not configured and the in-app queue is unaffected.

### Free-tier meters

`/admin/system` shows database and storage usage against the free-tier limits, how many more
bookings fit (projected from what stored ones actually weigh), which integrations are on, and
where documents are stored. The database meter is the one that matters: crossing 500 MB puts
Supabase into **read-only**, which here means bookings can be read but not signed. The
documented upgrade trigger is 70%.

```bash
npm run verify:notify    # 16 checks: who gets told, and what notifications may carry
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

## Hardening (Phase 8)

* **A Content-Security-Policy** on every response, plus `frame-ancestors 'none'`,
  `object-src 'none'`, `form-action 'self'` and `base-uri 'self'` — the directives that block
  the common attacks without needing a nonce. There is no nonce **by choice**: generating one
  means logic in `proxy.ts`, and that file is held to cookie-presence-only because Vercel may
  run it outside India. Residency is a legal obligation; CSP is defence in depth. The storage
  host is allowed in `img-src`, since documents and signatures are served by redirecting to a
  signed URL on it.
* **The login timing oracle is closed.** An unknown email used to return in a millisecond
  while a real one spent ~100ms in Argon2 — enough to enumerate staff addresses by timing,
  which is exactly what the single generic error message exists to prevent. Unknown accounts
  now verify against a decoy hash so both paths cost the same.
* **Error boundaries** at the segment, route and root-layout level. They deliberately say
  nothing about what failed: an error from a booking system can carry a Booking ID, an
  applicant's name or a database constraint, and the page is reachable by anyone with a
  session. The `digest` ties a report to the server log without putting anything in the
  browser. Nothing is sent to a third-party error tracker — the brief forbids it.
* **The 404 page serves double duty.** `requireRole` and `authoriseFormAccess` call
  `notFound()` rather than returning 403, so its wording has to be true both for a page that
  does not exist and for one that is not yours.

### Two deployment bugs this phase caught

* **`preferredRegion = 'bom1'` would have failed the deploy.** Next 16 deprecated the export,
  and Vercel now accepts only `'auto' | 'global' | 'home'` there — an unsupported value
  throws. Region pinning belongs in `vercel.json`, which is where it now lives exclusively.
* **The local storage driver was dragging the whole project into the deployment.** Turbopack
  saw a filesystem read it could not resolve statically and traced every source file and the
  entire `public/` folder into the output, in case one of them was the target. Caused
  entirely by a driver that refuses to run in production. The path-building and read calls
  now carry `turbopackIgnore`, and the build is warning-free.

## Deploying

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run test:e2e          # needs a database and a seeded org
```

1. **Supabase**, region `ap-south-1` (Mumbai). Create a **private** bucket named by
   `SUPABASE_STORAGE_BUCKET`. Copy the connection string into `DATABASE_URL` and the
   service-role key into `SUPABASE_SERVICE_ROLE_KEY`; storage switches over on its own.
2. `npm run db:deploy` to apply migrations, then `npm run db:seed` **once**, with
   `SEED_PASSWORD` set to something real. Change every demo password immediately, or create
   real accounts and deactivate the demo ones.
3. **Vercel**: import the repo, set every variable from `.env.example`, and confirm the
   project region is **Mumbai**. `vercel.json` pins functions to `bom1` and registers three
   crons (health keep-alive, project sync, digest).
4. **Verify the region of `proxy.ts` in the function logs.** PLAN.md §3 has flagged this as
   unresolved since Phase 1: Vercel documents Routing Middleware as deploying to all regions
   regardless of the `regions` setting, and whether the renamed Node-runtime proxy still does
   is not settled. It is cookie-presence-only precisely so the answer cannot matter — but
   confirm it, and keep it that way.
5. Approve `content/terms/v1.md` and set `tnc_versions.is_approved` before a real customer
   signs. Production refuses to submit against an unapproved version.

## Before production

* **Vercel Hobby is non-commercial use only** → move to **Pro**.
* **Supabase Free has no backups and pauses after ~7 days idle** → move to **Pro**.
  (A daily cron hits `/api/health` to defeat the pause meanwhile.)
* **`content/terms/v1.md` is transcribed from a photograph and not yet approved.** Its
  review checklist must be signed off, and `tnc_versions.is_approved` set, before any real
  customer signs.
