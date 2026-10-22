# FIELD_MAP.md

Every field on the paper form → DB column → input type → validation → required.

> ✅ **VERIFIED against `/reference/booking-form.jpeg` on 2026-10-22.**
> Every field below was read off the paper. **No field printed on the form is missing from this
> table, and no field in this table is absent from the form** — the brief's §2 inventory was
> complete. Four corrections were applied after reading the image; they are marked **[IMG]**.
> Box counts were confirmed by pixel-counting a 4× zoom: Mobile 10, Alternate Mobile 10,
> Adhaar 12, D.O.B 8. Remaining risk is layout proportion only, not field coverage.

Conventions: `R` = required, `O` = optional, `C` = conditionally required.
All text fields are trimmed; fields marked **UPPER** are transformed to uppercase on input and
stored uppercase, per the paper's "to be filled in CAPITAL LETTERS ONLY".
Money is `BIGINT` paise. Dates are `date`; timestamps are `timestamptz` UTC, displayed IST.

---

## 1. Header block — `booking_forms`

| # | Label on paper | DB column | Input type | Validation | Req |
|---|---|---|---|---|---|
| 1 | Booking Date | `booking_date` | date picker, defaults today | valid date, not future, not > 90 d past | **R** |
| 2 | Project Name | `project_id` → `projects.name` | select, **populated from the Google Sheet via cached sync** (PLAN §2A) — reads Postgres, never Sheets live | must be an **active** project row | **R** |
| 3 | Property type: Villa / Plot / Apartment No | `property_type` | checkbox group, **single select** | enum `VILLA｜PLOT｜APARTMENT` | **R** |
| 4 | *(Apartment number, adjacent to "Apartment No")* | `apartment_no` | text | max 20; required iff `property_type = APARTMENT` | **C** |
| 5 | Sales Executive | `sales_executive` | text, defaults to logged-in user if they hold that role | max 120 | **R** |
| 6 | Sales Head | `sales_head` | text / select | max 120 | **R** |
| 7 | Telecaller | `telecaller` | text | max 120 | O |
| 8 | Lead ID | `lead_id` | text, **typed by the sales executive** (Q3 answered) | max 60, trimmed, **no format validation** — it comes from your CRM and rejecting a valid ID would block a booking; indexed for search | **R** |
| 9 | Source | `source` | select (admin-managed enum) | seeded Walk-in, Referral, Digital, Other | **R** |
| 10 | Booking ID | `booking_id` | **read-only, auto** | `DAC/YYYY/NNNNN`, unique, allocated at submit | auto |

Booking ID is allocated **at submit, not at draft creation** — otherwise abandoned drafts burn
numbers and leave gaps in a sequence that finance will read as missing bookings.

---

## 2. PERSONAL INFORMATION — `applicants`

Two rows per form: `applicant_type = PRIMARY` (required) and `SECONDARY` (optional).
Columns 11–24 below exist once per row. "Req" shown as **R** for the primary applicant / for the
secondary applicant it is **C** — required only once a second applicant is added.

| # | Label on paper | DB column | Input type | Validation | Req (1st) |
|---|---|---|---|---|---|
| — | Photo of Sole/First (or Co/Second) Applicant | → `form_documents` (type `PHOTO`) | photo box, upload + preview | jpg/png, client-compressed to ~300 KB | **R** / O |
| 11 | Mr./Mrs./Ms. *(the printed options)* | `salutation` | radio | enum `MR｜MRS｜MS` | **R** |
| 12 | *(name, same line)* | `full_name` | text **UPPER** | 2–120, letters/space/dot/apostrophe/hyphen only | **R** |
| 13 | Son / Daughter / Wife of *(the printed options)* | `relation_type` | radio | enum `SON_OF｜DAUGHTER_OF｜WIFE_OF` | **R** |
| 14 | *(Mr./Mrs./Ms. of the guardian)* | `guardian_salutation` | radio | enum `MR｜MRS｜MS` | **R** |
| 15 | *(guardian name)* | `guardian_name` | text **UPPER** | 2–120, same charset as 12 | **R** |
| 16 | Mobile No | `mobile_no` | **`<BoxInput length={10} />`** | exactly 10 digits, first digit 6–9 | **R** |
| 17 | Alternate Mobile No | `alt_mobile_no` | **`<BoxInput length={10} />`** | 10 digits if present; must differ from 16 | O |
| 18 | Email ID | `email` | email | RFC-valid, max 254, lowercased | **R** |
| 19 | PAN (Mandatory) | `pan_encrypted` + `pan_last4` | text **UPPER** | `^[A-Z]{5}[0-9]{4}[A-Z]$`, **encrypted at rest** | **R** |
| 20 | **Adhaar No** **[IMG]** — the paper spells it "Adhaar", not "Aadhaar"; reproduce verbatim on screen and PDF | `aadhaar_encrypted` + `aadhaar_last4` | **`<BoxInput length={12} />`** — 12 boxes confirmed | 12 digits, **Verhoeff checksum**, first digit ≠ 0 or 1, **encrypted at rest** | **R** |
| 21 | D.O.B (DD/MM/YYYY) | `dob` | **`<BoxInput length={8} />`** — 8 boxes confirmed, printed as **4 visual pairs** (DD｜MM｜YY｜YY) **[IMG]**, + date-picker fallback | real calendar date, in the past, **age ≥ 18** | **R** |
| 22 | Occupation | `occupation` | text | max 120 | **R** |
| 23 | Company Name | `company_name` | text | max 160 | O |
| 24 | Designation | `designation` | text | max 120 | O |
| 25 | Location | `location` | text | max 160 | O |

Notes:
- **`<BoxInput>` is one reusable component** (brief §2.2) used at lengths 10, 12 and 8: one
  character per box, auto-advance, backspace returns to the previous box, full paste support,
  digits only, mobile numeric keypad, and a single aria-labelled value for screen readers.
- Aadhaar gets the **Verhoeff checksum**, not just a length check — it catches the common
  transposition typo that a 12-digit test would pass.
- Fields 19 and 20 are **regulated personal data**: encrypted (AES-256-GCM), only `*_last4`
  readable in lists and tables, every reveal written to `AuditLog` as `VIEW_SENSITIVE`, redacted
  in all logs, and never written to the Google Sheet.

---

## 3. Addresses — `addresses`

Two rows per form: `type = COMMUNICATION` and `type = PERMANENT`.

| # | Label on paper | DB column | Input type | Validation | Req |
|---|---|---|---|---|---|
| 26–29 | COMMUNICATION ADDRESS (4 lines) | `line1`…`line4` | 4 text inputs (or 4-row textarea) | each ≤ 100; `line1` required | **R** (line1) |
| 30–33 | PERMANENT ADDRESS (4 lines) | `line1`…`line4` | 4 text inputs | each ≤ 100; `line1` required | **R** (line1) |
| — | *"Same as communication address"* | not stored | checkbox | copies values on tick; **both addresses are still stored separately** (brief §2.3) | O |

See Q22 on whether a separate pincode column is wanted for reporting.

---

## 4. PROPERTY DETAILS — `booking_forms`

| # | Label on paper | DB column | Input type | Validation | Req |
|---|---|---|---|---|---|
| 34 | Built-up Area (Sq.Ft) | `built_up_area_sqft` | numeric | `Decimal(10,2)`, > 0, ≤ 100000 | **R** |
| 35 | UDS (Sq.Ft.) **[IMG]** — note the paper punctuates this one "Sq.Ft." with a trailing dot while #34 is "Sq.Ft" without; reproduce both verbatim | `uds_sqft` | numeric | `Decimal(10,2)`, > 0 | **R** |
| 36 | Floor | `floor` | text | max 20 — text, not int, so "G", "Stilt", "2 & 3" survive | O |

---

## 5. PAYMENT DETAILS — `booking_forms`

| # | Label on paper | DB column | Input type | Validation | Req |
|---|---|---|---|---|---|
| 37 | Booking Advance | `booking_advance_paise` | money (₹, Indian digit grouping) | `BIGINT` paise, > 0, ≤ `sale_price_paise` | **R** |
| 38 | Mode: Chq / Card / Online | `payment_mode` | checkbox group, single select | enum `CHQ｜CARD｜ONLINE` | **R** |
| 39 | Ref. No. | `payment_ref_no` | text | max 60 | **R** |
| 40 | Date | `payment_date` | date | valid, not future | **R** |
| 41 | Bank | `bank` | text | max 120 | **R** |
| 42 | Payment Source: Own Funds / Home Loan | `payment_source` | checkbox group, single select | enum `OWN_FUNDS｜HOME_LOAN` | **R** |
| 43 | Sale Price | `sale_price_paise` | money | `BIGINT` paise, > 0 | **R** |
| — | *"Excluding GST & Registration charges"* | n/a — static printed note | — | **must be rendered verbatim** on screen and in the PDF (brief §2.5) | — |

Money is stored as integer paise throughout and formatted for display only. Never a float.

---

## 6. REMARKS — `booking_forms`

| # | Label on paper | DB column | Input type | Validation | Req |
|---|---|---|---|---|---|
| 44 | REMARKS (if any) | `remarks` | textarea, 3 rows | max 1000 | O |

---

## 7. Supporting documents — `form_documents` / `document_types`

Data-driven via the `document_types` table so types can be added without code changes (brief §3).

| # | Document | Scope | Req | Accepted |
|---|---|---|---|---|
| 45 | Passport-size photo | 1st applicant | **M** | jpg, png |
| 46 | Passport-size photo | 2nd applicant | C (Q11) | jpg, png |
| 47 | PAN card | 1st applicant | **M** | pdf, jpg, png |
| 48 | PAN card | 2nd applicant | C (Q11) | pdf, jpg, png |
| 49 | Aadhaar card | 1st applicant | **M** | pdf, jpg, png |
| 50 | Aadhaar card | 2nd applicant | C (Q11) | pdf, jpg, png |
| 51 | 1st payment screenshot | form | **M** | jpg, png, pdf |
| 52 | Simple cost sheet | form | **M** | pdf, jpg, png |
| 53 | Mail | form | **M** (confirmed) | pdf, jpg, png — helper text *"Email confirmation from the customer"*, pending Q2 |
| 54 | Discount cost sheet | form | O | pdf, jpg, png |

All private buckets, keyed `bookings/{bookingId}/documents/...`, read only through short-lived
signed URLs issued after a server-side role check. Documents 45 and 46 also populate the photo
boxes on the form and in the PDF.

---

## 8. Acceptance and signatures

| # | Item | DB column | Type | Notes |
|---|---|---|---|---|
| 55 | "I have read and accept the Terms & Conditions" | `tnc_accepted_at` + `tnc_version_id` | checkbox | **R** at the applicant step; records *which T&C version* was signed |

Signature slots → `form_step_records.signature_asset_id`, keyed
`bookings/{bookingId}/signatures/...`:

| Slot | PDF position | In the digital flow? |
|---|---|---|
| 1st Applicant | p1 strip row 1 col 1, **and** T&C page "APPLICANT (1)" | ✔ step 1 (creator device, witnessed) |
| 2nd Applicant | p1 strip row 2 col 1, **and** T&C page "APPLICANT (2)" | ✔ step 2, skipped if no 2nd applicant |
| AGM | p1 strip row 1 col 2 | ✔ step 3 |
| DGM / GM | p1 strip row 2 col 2 | ✔ step 4 |
| VP Sales | p1 strip row 1 col 3 | ✔ step 5 |
| **Sales Co-ordinator** | **9th cell appended to the strip** (digital addition; carries signature + `Validated ✓ <date>`) — Q5 decided | ✔ step 6, VALIDATE + SIGN |
| MIS | p1 strip row 2 col 3 | ✔ step 7 |
| Director | p1 strip row 2 col 4 | ✔ step 8 |
| CRM | p1 strip row 1 col 4 | ✔ step 9 |
| Managing Director | p1, ruled line above-right of the strip | ✘ **blank print line — confirmed not in flow** (Q7 resolved) |
| Authorized Signatory, For DAC Developers Pvt Ltd | T&C page footer | ✘ **blank print line — confirmed not in flow** (Q7 resolved) |

---

## 9. Static printed text to reproduce verbatim

Not data, but required for visual fidelity — each must appear exactly as printed:

| # | Text | Where |
|---|---|---|
| 56 | **BOOKING FORM** (title) + DAC logo + blue/orange corner accents | p1 header |
| 57 | "PERSONAL INFORMATION (to be filled in CAPITAL LETTERS ONLY)" | p1 ribbon |
| 58 | "Excluding GST & Registration charges" | p1 under Sale Price |
| 59 | Left-edge vertical note, read from the image at 10× zoom: **`*Agreed terms mentioned in the booking form`** — leading asterisk, no closing full stop **[IMG, Q21 resolved]** | p1 left margin, rotated 90° |
| 60 | "TERMS & CONDITIONS FOR PROVISIONAL ALLOTMENT" + 8 section headings | p2 |
| 61 | "I hereby agreed and accepted the above-mentioned terms & condition of this provisional allotment." | p2 closing |

p2 section headings, **read from the image and verified [IMG]** — all 8 present, each bold and
followed by a colon, in this order:

1. `General Instructions:`
2. `Agreement of Sale Cum Construction:` — paper capitalises **Cum**; the brief had "cum"
3. `Arrangement of Finance / Loans:`
4. `Payment Terms & Conditions:`
5. `Standard Feature & Additional Features:`
6. `Work Availability:`
7. `Contribution to the Unit Owner's Association:`
8. `Withdrawal from the Project:`

Page 2 footer, verified: `For DAC Developers Pvt Ltd,` sits above the right-hand signature line;
the three labels are `APPLICANT (1)` · `APPLICANT (2)` · `AUTHORIZED SIGNATORY`.

**The body text under each heading is still not reproduced here** — but at 4× zoom it is fully
legible (clean laser print, not handwriting), so transcription is now viable with high
confidence. It remains legally binding text, so it still needs your sign-off (Q8).

---

## Totals

| | Count |
|---|---|
| Captured data fields (1–44) | 44 header/applicant/address/property/payment/remarks fields (applicant fields 11–25 exist **twice**, so 59 stored columns) |
| Document slots (45–54) | 10 |
| Acceptance (55) | 1 |
| Signature slots | 11 (9 in the digital flow, 2 blank print lines) |
| Static text blocks (56–61) | 6 |

**74 data fields** = 44 single-instance + 15 duplicated applicant fields + 10 documents + 1
acceptance + 4 addresses counted as blocks. Pending verification against the images (Q0).
