import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import {
  A4,
  ADDRESS_LINES,
  BOX_COUNTS,
  CHAR_BOX,
  COLOURS,
  CONTENT_WIDTH,
  DOB_GROUPS,
  FONT,
  LOGO,
  PAGE_MARGIN,
  PHOTO_BOX,
  RULE,
  SALE_PRICE_NOTE,
  SIGNATURE_CELL,
  SIGNATURE_GRID,
  TERMS_ACCEPTANCE_LINE,
  TERMS_COMPANY_LINE,
  TERMS_SIGNATURES,
  TICKS,
  VERTICAL_NOTE,
  boxGroups,
  charactersFor,
  dobCharacters,
  logoHeight,
} from '@/lib/pdf/form-layout';
import { parseTerms } from '@/lib/forms/terms-markdown';
import type { PdfApplicant, PdfData, PdfSignature } from '@/lib/pdf/data';

/**
 * The printed Booking Form — page 1 of the paper, and the Terms page 2.
 *
 * Authored in react-pdf primitives, which is a **different layout engine from
 * the browser**: no CSS Grid, limited flexbox, no percentage heights. PLAN.md
 * §4 took that trade knowingly, and every proportion here comes from
 * `@/lib/pdf/form-layout` so the screen replica and this cannot drift apart.
 *
 * The brief is explicit that the digital form must look and read like the
 * paper, so the order, wording and furniture below are reproduced rather than
 * improved: the grey section ribbons, the character boxes, the tick squares,
 * the note printed sideways up the left margin, and the signature grid whose
 * printed order is by seniority rather than by the order people actually sign.
 */

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_MARGIN,
    paddingBottom: PAGE_MARGIN,
    paddingHorizontal: PAGE_MARGIN,
    fontSize: FONT.value,
    fontFamily: 'Helvetica',
    color: COLOURS.ink,
    position: 'relative',
  },

  // --- brand furniture -----------------------------------------------------
  bannerBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 16,
    backgroundColor: COLOURS.bannerBlue,
  },
  bannerBottomAccent: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 46,
    height: 16,
    backgroundColor: COLOURS.bannerRed,
    transform: 'skewX(-24deg)',
  },
  cornerBlue: {
    position: 'absolute',
    left: -26,
    top: -26,
    width: 72,
    height: 72,
    backgroundColor: COLOURS.bannerBlue,
    transform: 'rotate(45deg)',
  },
  cornerRed: {
    position: 'absolute',
    left: 6,
    top: -34,
    width: 72,
    height: 72,
    backgroundColor: COLOURS.bannerRed,
    transform: 'rotate(45deg)',
  },

  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  logoImage: { width: LOGO.width, height: logoHeight(), objectFit: 'contain' },
  logoText: { fontSize: 19, fontFamily: 'Helvetica-Bold', letterSpacing: 1.5 },
  logoPlaceholderNote: { fontSize: 4.5, color: COLOURS.placeholder, textAlign: 'right' },

  title: {
    textAlign: 'center',
    fontSize: FONT.title,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
    letterSpacing: 0.4,
  },

  // --- generic furniture ---------------------------------------------------
  box: {
    borderWidth: RULE.border,
    borderColor: COLOURS.border,
    padding: 5,
  },
  ribbonWrap: { flexDirection: 'row', marginBottom: -5, marginLeft: 8 },
  ribbon: {
    backgroundColor: COLOURS.ribbonFill,
    borderWidth: RULE.border,
    borderColor: COLOURS.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: FONT.ribbon,
    fontFamily: 'Helvetica-Bold',
  },

  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 },
  label: { fontSize: FONT.label },
  fill: {
    borderBottomWidth: RULE.fill,
    borderBottomColor: COLOURS.rule,
    flexGrow: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    minHeight: 9,
  },
  fillText: { fontSize: FONT.value },

  charBox: {
    width: CHAR_BOX.width,
    height: CHAR_BOX.height,
    borderWidth: RULE.fill,
    borderColor: COLOURS.boxBorder,
    marginRight: CHAR_BOX.gap,
    textAlign: 'center',
    fontSize: FONT.boxChar,
    paddingTop: 2.5,
  },

  tickSquare: {
    width: 7.5,
    height: 7.5,
    borderWidth: RULE.fill,
    borderColor: COLOURS.boxBorder,
    marginRight: 2.5,
    textAlign: 'center',
    fontSize: 6,
    paddingTop: 0.6,
  },

  photoBox: {
    width: PHOTO_BOX.width,
    height: PHOTO_BOX.height,
    borderWidth: RULE.border,
    borderColor: COLOURS.border,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  photoCaption: { fontSize: FONT.tiny, textAlign: 'center', color: COLOURS.rule },
  photoImage: { width: '100%', height: '100%', objectFit: 'cover' },

  verticalNote: {
    position: 'absolute',
    left: 4,
    bottom: 150,
    width: 180,
    fontSize: 4.8,
    color: COLOURS.rule,
    transform: 'rotate(-90deg)',
    transformOrigin: 'left bottom',
  },

  // --- signature grid ------------------------------------------------------
  signatureRow: { flexDirection: 'row' },
  signatureCell: {
    width: CONTENT_WIDTH / SIGNATURE_CELL.columns,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  signatureLabel: { fontSize: FONT.label, width: SIGNATURE_CELL.labelWidth },
  signatureWell: {
    borderWidth: RULE.border,
    borderColor: COLOURS.border,
    height: SIGNATURE_CELL.height,
    flexGrow: 1,
    marginRight: 3,
    padding: 1,
  },
  signatureImage: { width: '100%', height: '100%', objectFit: 'contain' },
  signatureCaption: { fontSize: 4.2, color: COLOURS.rule, marginTop: 0.5 },

  // --- terms page ----------------------------------------------------------
  termsTitle: {
    textAlign: 'center',
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
  },
  termsHeading: {
    fontSize: FONT.termsHeading,
    fontFamily: 'Helvetica-Bold',
    marginTop: 4,
    marginBottom: 1.5,
  },
  termsParagraph: {
    fontSize: FONT.terms,
    textAlign: 'justify',
    marginBottom: 3,
    lineHeight: 1.35,
  },
});

// --- small pieces ----------------------------------------------------------

function Ribbon({ children }: { children: string }) {
  return (
    <View style={styles.ribbonWrap}>
      <Text style={styles.ribbon}>{children}</Text>
    </View>
  );
}

/** `Label : ______value______` — the basic unit of the paper form. */
function Field({
  label,
  value,
  width,
  labelWidth,
}: {
  label: string;
  value: string;
  /** Fraction of the row this field occupies. */
  width?: string | number;
  labelWidth?: number;
}) {
  return (
    <View style={[styles.row, width !== undefined ? { width } : { flexGrow: 1 }]}>
      <Text style={[styles.label, labelWidth !== undefined ? { width: labelWidth } : {}]}>
        {label}
      </Text>
      <Text style={styles.label}> : </Text>
      <View style={styles.fill}>
        <Text style={styles.fillText}>{value}</Text>
      </View>
    </View>
  );
}

/**
 * The printed character squares, one glyph each.
 *
 * Takes the glyphs already spread by `charactersFor`/`dobCharacters` rather
 * than the raw value, so there is one place that decides how a value maps onto
 * boxes and this only draws them.
 */
function CharBoxRun({
  glyphs,
  groups,
}: {
  glyphs: string[];
  groups?: readonly number[];
}) {
  const sizes = boxGroups(glyphs.length, groups);

  // Offsets computed up front rather than accumulated while mapping: a render
  // function that mutates as it goes is not safe to re-run, and React will say
  // so.
  const slices = sizes.map((size, groupIndex) => {
    const start = sizes.slice(0, groupIndex).reduce((sum, n) => sum + n, 0);
    return glyphs.slice(start, start + size);
  });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {slices.map((slice, groupIndex) => (
        <View
          key={groupIndex}
          style={{
            flexDirection: 'row',
            marginRight: groupIndex < slices.length - 1 ? CHAR_BOX.groupGap : 0,
          }}
        >
          {slice.map((glyph, i) => (
            <Text key={i} style={styles.charBox}>
              {glyph}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function CharBoxes({ value, count }: { value: string | null; count: number }) {
  return <CharBoxRun glyphs={charactersFor(value, count)} />;
}

function DobBoxes({ dob }: { dob: string | null }) {
  return <CharBoxRun glyphs={dobCharacters(dob)} groups={DOB_GROUPS} />;
}

function Tick({ label, checked }: { label: string; checked: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
      <Text style={styles.tickSquare}>{checked ? 'X' : ' '}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function ApplicantBlock({
  applicant,
  caption,
}: {
  applicant: PdfApplicant | null;
  caption: string;
}) {
  const a = applicant;

  return (
    <View style={[styles.box, { marginBottom: 5 }]}>
      <View style={{ flexDirection: 'row' }}>
        <View style={styles.photoBox}>
          {a?.photoDataUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={a.photoDataUrl} style={styles.photoImage} />
          ) : (
            <Text style={styles.photoCaption}>{caption}</Text>
          )}
        </View>

        <View style={{ flexGrow: 1 }}>
          <View style={styles.row}>
            <Field label="Mr./Mrs./Ms." value={`${a?.salutation ?? ''} ${a?.fullName ?? ''}`.trim()} width="52%" />
            <Field
              label="Son / Daughter / Wife of : Mr./Mrs./Ms."
              value={a?.guardianName ?? ''}
              width="48%"
            />
          </View>

          <View style={styles.row}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '52%' }}>
              <Text style={[styles.label, { width: 44 }]}>Mobile No</Text>
              <Text style={styles.label}> : </Text>
              <CharBoxes value={a?.mobileNo ?? ''} count={BOX_COUNTS.mobile} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '48%' }}>
              <Text style={[styles.label, { width: 44 }]}>Alternate{'\n'}Mobile No</Text>
              <Text style={styles.label}> : </Text>
              <CharBoxes value={a?.altMobileNo ?? ''} count={BOX_COUNTS.altMobile} />
            </View>
          </View>

          <View style={styles.row}>
            <Field label="Email ID" value={a?.email ?? ''} width="52%" labelWidth={44} />
            <Field label="PAN (Mandatory)" value={a?.pan ?? ''} width="48%" />
          </View>

          <View style={styles.row}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '58%' }}>
              <Text style={[styles.label, { width: 44 }]}>Adhaar No</Text>
              <Text style={styles.label}> : </Text>
              <CharBoxes value={a?.aadhaar ?? ''} count={BOX_COUNTS.aadhaar} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '42%' }}>
              <Text style={[styles.label, { width: 42 }]}>D.O.B{'\n'}(DD/MM/YYYY)</Text>
              <Text style={styles.label}> : </Text>
              <DobBoxes dob={a?.dob ?? null} />
            </View>
          </View>

          <View style={styles.row}>
            <Field label="Occupation" value={a?.occupation ?? ''} width="52%" labelWidth={44} />
            <Field label="Company Name" value={a?.companyName ?? ''} width="48%" />
          </View>

          <View style={[styles.row, { marginBottom: 0 }]}>
            <Field label="Designation" value={a?.designation ?? ''} width="60%" labelWidth={44} />
            <Field label="Location" value={a?.location ?? ''} width="40%" />
          </View>
        </View>
      </View>
    </View>
  );
}

function AddressBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <View style={{ width: '49%' }}>
      <Ribbon>{title}</Ribbon>
      <View style={[styles.box, { paddingTop: 8 }]}>
        {Array.from({ length: ADDRESS_LINES }, (_, i) => (
          <View
            key={i}
            style={{
              borderBottomWidth: RULE.fill,
              borderBottomColor: COLOURS.rule,
              minHeight: 11,
              paddingBottom: 1,
              marginBottom: 3,
            }}
          >
            <Text style={styles.fillText}>{lines[i] ?? ''}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SignatureWell({ signature }: { signature: PdfSignature | undefined }) {
  return (
    <View style={styles.signatureWell}>
      {signature ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image src={signature.dataUrl} style={styles.signatureImage} />
      ) : null}
    </View>
  );
}

// --- the document ----------------------------------------------------------

export function BookingFormPdf({ data }: { data: PdfData }) {
  const printed = SIGNATURE_GRID.filter((c) => c.onPaper);
  const appended = SIGNATURE_GRID.filter((c) => !c.onPaper);
  const rows = [0, 1];

  return (
    <Document
      title={data.bookingId || 'Booking Form'}
      author="DAC Developers Pvt Ltd"
      subject="Booking Form"
      creator="DAC Booking Form Portal"
      producer="DAC Booking Form Portal"
    >
      {/* ===================== PAGE 1 — the booking form ==================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.cornerBlue} fixed />
        <View style={styles.cornerRed} fixed />
        <View style={styles.bannerBottom} fixed />
        <View style={styles.bannerBottomAccent} fixed />

        <View style={styles.header}>
          <View style={{ flexGrow: 1 }} />
          <View style={{ alignItems: 'flex-end' }}>
            {data.logoDataUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.logoDataUrl} style={styles.logoImage} />
            ) : (
              <>
                <Text style={styles.logoText}>DAC</Text>
                <Text style={styles.logoPlaceholderNote}>logo placeholder</Text>
              </>
            )}
          </View>
        </View>

        <Text style={styles.title}>BOOKING FORM</Text>

        {/* --- header block --- */}
        <View style={[styles.box, { marginBottom: 6 }]}>
          <View style={styles.row}>
            <Field label="Booking Date" value={data.bookingDate} width="33%" labelWidth={54} />
            <Field label="Project Name" value={data.projectName} width="34%" labelWidth={54} />
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '33%' }}>
              {TICKS.propertyType.map((option) => (
                <Tick
                  key={option.value}
                  label={option.label}
                  checked={data.propertyType === option.value}
                />
              ))}
              <View style={styles.fill}>
                <Text style={styles.fillText}>{data.apartmentNo}</Text>
              </View>
            </View>
          </View>

          <View style={styles.row}>
            <Field label="Sales Executive" value={data.salesExecutive} width="33%" labelWidth={54} />
            <Field label="Sales Head" value={data.salesHead} width="34%" labelWidth={54} />
            <Field label="Telecaller" value={data.telecaller} width="33%" labelWidth={44} />
          </View>

          <View style={[styles.row, { marginBottom: 0 }]}>
            <Field label="Lead ID" value={data.leadId} width="33%" labelWidth={54} />
            <Field label="Source" value={data.source} width="34%" labelWidth={54} />
            <Field label="Booking ID" value={data.bookingId} width="33%" labelWidth={44} />
          </View>
        </View>

        {/* --- personal information --- */}
        <Ribbon>PERSONAL INFORMATION (TO BE FILLED IN CAPITAL LETTERS ONLY)</Ribbon>
        <View style={{ paddingTop: 7 }}>
          <ApplicantBlock applicant={data.firstApplicant} caption="Photo of Sole / First Applicant" />
          <ApplicantBlock applicant={data.secondApplicant} caption="Photo of Co / Second Applicant" />
        </View>

        {/* --- addresses --- */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <AddressBox title="COMMUNICATION ADDRESS" lines={data.communicationAddress} />
          <AddressBox title="PERMANENT ADDRESS" lines={data.permanentAddress} />
        </View>

        {/* --- property and payment --- */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <View style={{ width: '43%' }}>
            <Ribbon>PROPERTY DETAILS</Ribbon>
            <View style={[styles.box, { paddingTop: 9 }]}>
              <Field label="Built-up Area (Sq.Ft)" value={data.builtUpAreaSqft} labelWidth={84} />
              <Field label="UDS (Sq.Ft.)" value={data.udsSqft} labelWidth={84} />
              <View style={[styles.row, { marginBottom: 0 }]}>
                <Field label="Floor" value={data.floor} labelWidth={84} />
              </View>
            </View>
          </View>

          <View style={{ width: '55%' }}>
            <Ribbon>PAYMENT DETAILS</Ribbon>
            <View style={[styles.box, { paddingTop: 9 }]}>
              <View style={styles.row}>
                <Field label="Booking Advance" value={data.bookingAdvance} width="58%" labelWidth={70} />
                <View style={{ flexDirection: 'row', alignItems: 'center', width: '42%' }}>
                  {TICKS.paymentMode.map((option) => (
                    <Tick
                      key={option.value}
                      label={option.label}
                      checked={data.paymentMode === option.value}
                    />
                  ))}
                </View>
              </View>

              <View style={styles.row}>
                <Field label="Ref.No" value={data.paymentRefNo} width="38%" labelWidth={32} />
                <Field label="Date" value={data.paymentDate} width="30%" labelWidth={22} />
                <Field label="Bank" value={data.bank} width="32%" labelWidth={24} />
              </View>

              <View style={[styles.row, { marginBottom: 0 }]}>
                <Text style={[styles.label, { width: 70 }]}>Payment Source</Text>
                <Text style={styles.label}> : </Text>
                {TICKS.paymentSource.map((option) => (
                  <Tick
                    key={option.value}
                    label={option.label}
                    checked={data.paymentSource === option.value}
                  />
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* --- remarks and sale price --- */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <View style={{ width: '62%' }}>
            <Ribbon>REMARKS (if any)</Ribbon>
            <View style={[styles.box, { paddingTop: 9, minHeight: 52 }]}>
              <Text style={[styles.fillText, { lineHeight: 1.5 }]}>{data.remarks}</Text>
            </View>
          </View>

          <View style={{ width: '36%' }}>
            <View style={[styles.box, { paddingVertical: 6 }]}>
              <Field label="Sale Price" value={data.salePrice} labelWidth={48} />
              <Text style={{ fontSize: 4.6, textAlign: 'right', color: COLOURS.rule }}>
                {SALE_PRICE_NOTE}
              </Text>
            </View>
            <View style={{ marginTop: 14, alignItems: 'center' }}>
              <View
                style={{
                  borderBottomWidth: RULE.fill,
                  borderBottomColor: COLOURS.rule,
                  width: '86%',
                  height: 16,
                }}
              />
              <Text style={[styles.label, { marginTop: 1 }]}>Managing Director</Text>
            </View>
          </View>
        </View>

        {/* --- the signature grid --- */}
        <View>
          {rows.map((row) => (
            <View key={row} style={styles.signatureRow}>
              {printed
                .filter((cell) => cell.row === row)
                .sort((a, b) => a.column - b.column)
                .map((cell) => (
                  <View key={cell.slot} style={styles.signatureCell}>
                    <Text style={styles.signatureLabel}>{cell.label}:</Text>
                    <SignatureWell signature={data.signatures[cell.slot]} />
                  </View>
                ))}
            </View>
          ))}

          {/* Not on the paper (OPEN_QUESTIONS Q5) — appended so the ninth
              signature in the pipeline is still visible on the printed form. */}
          {appended.map((cell) => (
            <View key={cell.slot} style={styles.signatureRow}>
              <View style={[styles.signatureCell, { width: CONTENT_WIDTH / 2 }]}>
                <Text style={[styles.signatureLabel, { width: 76 }]}>{cell.label}:</Text>
                <SignatureWell signature={data.signatures[cell.slot]} />
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.verticalNote}>{VERTICAL_NOTE}</Text>
      </Page>

      {/* ===================== PAGE 2 — terms & conditions ================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.bannerBottom} fixed />
        <View style={styles.bannerBottomAccent} fixed />

        <View style={[styles.box, { paddingHorizontal: 10, paddingVertical: 10 }]}>
          {data.terms ? (
            parseTerms(data.terms.body).map((block, index) => {
              if (block.kind === 'title') {
                return (
                  <Text key={index} style={styles.termsTitle}>
                    {block.text}
                  </Text>
                );
              }
              if (block.kind === 'heading') {
                return (
                  <Text key={index} style={styles.termsHeading}>
                    {block.text}
                  </Text>
                );
              }
              return (
                <Text key={index} style={styles.termsParagraph}>
                  {block.spans.map((span) => span.text).join('')}
                </Text>
              );
            })
          ) : (
            <Text style={styles.termsParagraph}>
              No Terms &amp; Conditions version was recorded against this booking.
            </Text>
          )}

          <Text style={[styles.termsParagraph, { marginTop: 10 }]}>
            {TERMS_ACCEPTANCE_LINE}
          </Text>

          <Text style={[styles.label, { textAlign: 'right', marginTop: 16 }]}>
            {TERMS_COMPANY_LINE}
          </Text>

          <View style={{ flexDirection: 'row', marginTop: 34 }}>
            {TERMS_SIGNATURES.map((cell) => (
              <View key={cell.label} style={{ width: '33.33%', alignItems: 'center' }}>
                <View style={{ height: 30, width: '82%' }}>
                  {cell.slot && data.signatures[cell.slot] ? (
                    // eslint-disable-next-line jsx-a11y/alt-text
                    <Image
                      src={(data.signatures[cell.slot] as PdfSignature).dataUrl}
                      style={styles.signatureImage}
                    />
                  ) : null}
                </View>
                <Text style={[styles.label, { fontFamily: 'Helvetica-Bold' }]}>{cell.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text
          style={{
            position: 'absolute',
            left: PAGE_MARGIN,
            bottom: 22,
            fontSize: 4.6,
            color: COLOURS.rule,
          }}
          fixed
        >
          {data.bookingId ? `${data.bookingId} · ` : ''}
          {data.terms ? `T&C ${data.terms.version} · ` : ''}
          Generated {new Intl.DateTimeFormat('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Kolkata',
          }).format(data.generatedAt)}
        </Text>
      </Page>
    </Document>
  );
}

/** Exported for the fidelity harness, which renders a page at a time. */
export const PDF_PAGE_SIZE = A4;
