# OPEN_QUESTIONS.md

Every ambiguity I found, grouped by priority, each with the default I will use if you say nothing.
**I have not guessed anywhere — these are listed, not silently resolved.**

Reply with just the question numbers and your answers, e.g. "Q1 b, Q2 email PDF, Q3 typed".

---

## P0 — blocks Stage 2 (I cannot write correct code without these)

### ~~Q0. The two reference images are missing~~ — ✅ RESOLVED 2026-10-22
Found in `C:\Users\…\Downloads` (saved 16:46, with a double dot in the filename:
`booking-form..jpeg`), copied into `/reference/` under the expected names. Both are 1280×960,
~150–195 KB, photographed rotated 90°.

**Verification result: the field inventory is complete.** Every field on the paper is in
`FIELD_MAP.md`, and nothing in `FIELD_MAP.md` is absent from the paper. Four label corrections
were applied (marked `[IMG]`): "Adhaar" not "Aadhaar", "UDS (Sq.Ft.)" punctuation, the exact
vertical-note wording, and "Sale Cum Construction" capitalisation. All four `BoxInput` lengths
confirmed by zoom: 10 / 10 / 12 / 8.

**Residual risk, now the only one: resolution.** 1280×960 is fine for reading labels and for
transcribing the T&C, but it is thin for *pixel-faithful* geometry work in Phase 6 — I can see
*that* a box exists, not its exact width to the millimetre. A flatbed scan at 300 dpi, or even a
straight-on phone photo at full camera resolution, would make the PDF comparison materially
easier. Not a blocker; worth 2 minutes if the originals are to hand.

### ~~Q1. When are the applicant signatures captured?~~ — ✅ RESOLVED 2026-10-22 (by inference)
You said: *"for the signature i gave u the flow u can follow that."* Your flow lists the applicants
as **steps 1 and 2 of the pipeline**, so they are pipeline steps, not wizard steps → **option (b)**:
the form is submitted and locked first, then the creator opens step 1 and hands the device to the
applicant. Applicant signatures become first-class audited steps, and a later approver can return
the form specifically to the applicant step.

*If you actually meant the applicant signs inside the creation wizard before submit (option a),
say "Q1 a" and I will flip it — it is a flow-engine change, cheapest to make now.*

<details><summary>Original question, for reference</summary>
Your §5.1 lists the applicants as pipeline **steps 1 and 2**, but §6.3 lists "Review and T&C" then
"Submit" as the last steps of the **creation wizard**. Those imply different things, and the
difference is user-visible:

- **(a)** Capture *before* submit, inside the wizard. Submit then goes straight to AGM. Simpler for
  the sales executive — one sitting with the applicant, one hand-over of the tablet. But the
  applicant signs a form that has not yet been locked.
- **(b)** Capture *after* submit, as real pipeline steps 1–2 assigned to the creator. The form is
  locked before anyone signs, the applicant signature is a first-class audited step, and a return
  can target the applicant step specifically. One extra screen for the creator.

**Recommended default: (b).** The applicant is signing a legal allotment document; it should be
immutable at the moment of signing, and the audit trail should treat their signature exactly like
every other. Please confirm — reversing this later touches the flow engine and the wizard.

</details>

### ~~Q2. What exactly is the "Mail" document?~~ — ✅ ANSWERED 2026-10-22
**Mandatory**, and the content is **a photo the sales executive uploads** — i.e. a photograph or
screenshot of the mail, not a forwarded `.eml` or an exported PDF.

Built as: label `Mail`, helper text *"Photo or screenshot of the mail"*, accepted types
**jpg / png / pdf** (pdf kept because phone "scan to PDF" is common and rejecting it would just
make staff convert files by hand), client-side compression to ~500 KB like the other scans,
required before submit.

It is one row in `document_types`, so the label, helper text and accepted types stay editable from
the admin screen without a deploy.

### ~~Q3. Lead ID — typed or auto-generated?~~ — ✅ ANSWERED 2026-10-22: **typed**
Free text, typed by the sales executive, **required**. We do not generate it and we do not
validate its format (no format was given, and rejecting a valid CRM ID would block a booking).
Stored as entered, trimmed. Indexed, so finance can search by it.

### Q4. Project list and Source options — ✅ ANSWERED: from a Google Sheet, **wired last (Phase 7)**
**Your answer: project names are fetched from a Google Sheet.** `Source` stays an admin-editable
list seeded with Walk-in, Referral, Digital, Other (you did not mention it; say so if it should
also come from the sheet).

This **reverses the direction of the Sheets integration.** The brief (§8A) was explicit that
Supabase is the source of truth and *"the app never reads business data back from the sheet."*
Reading the project list makes Sheets a **read dependency in the create-form path** — if Google is
down, rate-limits us, or someone edits a cell badly, nobody can create a booking.

**I am building it as a cached read-through, not a live lookup** (design in `PLAN.md` §2A):
Postgres keeps the `Project` rows and remains the FK target; a sync job pulls the sheet and
upserts; the form always reads Postgres. A Sheets outage then costs you *new* project names, not
the ability to book. Projects that vanish from the sheet are marked inactive, never deleted, so
existing bookings keep resolving.

**DEFERRED by you 2026-10-22:** *"sheet and tab we can create last and we'll wire it up."*
Agreed — the sheet is not on the critical path. Revised plan:

- **Phase 1** ships `Project` with **admin CRUD**, so staff can add projects by hand and nothing
  is blocked. Seeded with a couple of placeholder projects for testing.
- **Phase 7** wires `ProjectSync` to the real sheet, behind the interface built in Phase 1.
  Switching over is config, not code.

**The one thing I am locking in now, because retrofitting it is painful:** the `Project` table
carries **`external_code`** and **`is_active`** from the first migration, even though nothing
writes them yet. If those columns arrive later, the first sync has to match existing hand-entered
rows against sheet rows with no shared key — that is a manual data-reconciliation job on live
bookings, exactly the kind of thing that silently duplicates projects and splits reporting. Two
unused columns today buys a clean switch-over later.

**When you build the sheet, I will need:** the URL and tab name; which column is the project name;
**whether there is a stable project code column** (if not, the first sync has to match on name,
and a later typo fix in the sheet creates a duplicate rather than a rename); and any other columns
worth pulling, such as location or an active/inactive flag.

---

## P1 — blocks a specific phase, not the start

### ~~Q5. Where does the Sales Co-ordinator signature box sit on the PDF?~~ — ✅ DECIDED 2026-10-22
Your flow includes **Sales Co-ordinator at step 6 (VALIDATE + SIGN)**, and the paper has no box for
it, so the PDF must gain one. Taking the default and proceeding:

**A 9th cell is appended to the signature strip**, labelled `Sales Co-ordinator`, carrying the
signature plus a small `Validated ✓ <date>` mark. The paper's 2 × 4 grid is left untouched so the
printed layout stays recognisable; the new cell is visually distinct as a digital addition.

Easy to move in Phase 6 — it is one entry in `formLayout.ts`. Tell me then if you would rather have
it as a separate "Validated by" stamp near the Booking ID.

### Q6. Do signatures already collected stay valid after the creator edits a returned form? *(your item 6)*
**Default: yes** — they stay valid, every edit is logged, and later approvers see an "edited after
return" banner with a field-level diff.
**This is a legal question, not a technical one.** If an AGM signed a form showing a sale price of
₹50,00,000 and the creator then changes it to ₹45,00,000, the default keeps the AGM's signature on
a document they never agreed to. The stricter alternative is to invalidate every signature after
the returning step whenever a **material** field (sale price, booking advance, property, applicant
identity) changes, while leaving cosmetic fixes alone. I recommend the stricter rule for material
fields and would like your decision on record.

### ~~Q7. Managing Director and Authorized Signatory — in the flow?~~ — ✅ RESOLVED 2026-10-22
Your flow has exactly **nine** steps and neither appears in it, and you confirmed the flow stands
as given. So: **neither is in the digital flow.**

- **Managing Director** (page 1) → rendered as a blank, print-ready ruled line, matching the paper.
- **Authorized Signatory, For DAC Developers Pvt Ltd** (page 2) → blank print-ready line.

Both are signed wet, on paper, after the PDF is downloaded. Nobody is assigned them, no role
exists for them, and a form reaches **Completed** when **CRM signs at step 9** — it does not wait
on either of these.

### ~~Q8. T&C text — paste or transcribe?~~ — ✅ DONE 2026-10-22: **transcribed from the photo**
All 8 sections are transcribed into **`/content/terms/v1.md`**, verbatim including the printed
form's own errors. No word was illegible, so there are no `[?word]` markers.

**It is marked `status: TRANSCRIBED — PENDING DAC LEGAL REVIEW` and must not ship until ticked
off.** The file carries its own review checklist: **8 apparent errors in the printed form** (§A),
**14 numerals** to verify (§B), and **3 abbreviations** (§C).

The headline item is **A1: the section headed "Work Availability" is entirely about water supply**
— wells, drinking and cooking. It is almost certainly meant to read *"Water Availability"*. I
verified the printed word at 20× zoom and it unambiguously says **"Work"**, so I reproduced it.
Changing a section heading on a signed legal document is DAC's call, not mine.

Also flagged: `attottee/s` (likely "allottee/s"), a missing full stop that runs two sentences
together in Payment Terms, `5%of` and `90days` missing spaces, and the Contribution section
calling the same body two different names.

### Q9. Demo / seed user names and roles *(your item 9)*
**Default:** generic seed users — `admin@dac.test`, `exec@dac.test`, `agm@dac.test`,
`gm@dac.test`, `vpsales@dac.test`, `coordinator@dac.test`, `mis@dac.test`,
`director@dac.test`, `crm@dac.test`, all with a dev-only password, all on a `.test` domain so they
can never receive real email. Real staff accounts get created by an admin in the UI, never seeded.

### Q10. Single long page or multi-step wizard for form creation? *(your §6.3 "[[preference]]")*
**Default: multi-step wizard** on mobile/tablet, **single long paper-like sheet** on desktop, same
Zod schema and same autosave behind both. The sales executive fills it on a tablet (where a long
sheet is painful) but the brief also requires the desktop view to read like the paper.

### Q11. Do the second applicant's documents become mandatory automatically? *(your §3)*
**Default: yes** — adding a second applicant makes their photo, PAN and Aadhaar mandatory, driven
by the `DocumentRequirement` table (no code change to alter it later).

---

## P2 — operational, decide before go-live

### Q12. Where is the weekly backup export kept? *(your item 11)*
Must be in India. **Default:** a named company PC under a documented owner, plus a second copy on
an Indian-region drive. I will write `scripts/backup.ts` and the runbook; you choose the location
and the person responsible.

### Q13. Max upload size per file? *(your §3 "[[default 5 MB]]")*
**Default: 10 MB accepted at the picker, compressed on the client to ~300 KB for photos and
~500 KB for scans, and the compressed result is what gets stored.** A 5 MB hard reject at the
picker frustrates users whose phone camera produces 8 MB JPEGs that would have compressed fine.
Supabase's own ceiling is 50 MB, so 10 MB is safe.

### Q14. Retention period and compliance requirement for Aadhaar/PAN? *(your §9)*
**Default: none implemented in v1** beyond encryption, masking and access logging — but a
retention rule is easiest to build in now, as a nightly job that purges or re-encrypts Aadhaar
after N years. Does DAC have a stated policy, or a RERA/audit obligation that fixes a minimum
retention period? These two pull in opposite directions and I do not want to assume either.

### Q15. Error tracking — Sentry? *(your §9)*
**Default: no third-party error tracker in v1.** Structured server logs only, with PAN/Aadhaar
redacted at the logger. Sentry would ship stack traces (which can carry form data) to servers
outside India, conflicting with your hard residency requirement. If you want Sentry, it needs a
scrubbing config and an accepted-risk note.

### Q16. Move date from free to paid plans *(your item 12)*
Not a question so much as a commitment I need: **Vercel Hobby is non-commercial-use only**, so
DAC is in breach from the first real booking, and **Supabase free has no backups**. Both must be
upgraded before real customer data goes in. **Default: upgrade at the end of Phase 8**, before UAT
with real bookings. ~₹3,500/month combined at current list prices.

### Q17. "Duplicate as new" on My Forms? *(your §6.4 "[[y/n]]")*
**Default: no, not in v1.** Copying a form that contains PAN, Aadhaar and DOB is an easy way to
create a wrong-person record, and the audit story is murky. Easy to add later if staff ask.

### Q18. Reminder threshold for a pending step? *(your §5.3 "[[default 2 days]]")*
**Default: 2 days**, as one batched daily digest per user (see the Resend 100/day cap in PLAN §5),
admin-configurable.

### Q19. Optional saved/reusable signatures for approvers? *(your §5.3)*
**Default: not in v1** — every signer draws each time. A stored, replayable signature weakens the
evidentiary value of the whole trail.

### Q20. One signature capture for both page 1 and the T&C page? *(your §5.3)*
**Default: yes** — one capture per applicant, placed in both slots, with the T&C acceptance
checkbox and timestamp recorded separately. Confirm this is acceptable for your purposes.

### ~~Q21. Exact wording of the left-edge vertical note on page 1~~ — ✅ RESOLVED 2026-10-22
Read from the image at 10× zoom: **`*Agreed terms mentioned in the booking form`** — leading
asterisk, no closing full stop. Your approximation was correct apart from the asterisk. It runs
vertically up the left margin of page 1 and will be reproduced as such on screen and in the PDF.

### Q22. Addresses — do you need a separate pincode field? *(my question)*
The paper has 4 free lines per address and I will reproduce exactly that. But if you ever want to
report or filter by city or pincode, those need to be their own columns — retrofitting them means
re-parsing free text later. **Default: 4 free lines only, faithful to the paper.**
