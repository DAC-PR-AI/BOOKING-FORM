# Brand assets

Drop the DAC logo in here. It is read at render time, so no code change and no
restart is needed — the next PDF picks it up.

## The logo

| | |
|---|---|
| Filename | `logo.png` (also accepted: `logo.jpg`, `logo.jpeg`, `dac-logo.png`) |
| Format | PNG with a **transparent background** is best; JPEG works |
| Size | around **600 × 200 px** or larger — it prints into a 74 × 26 pt box |
| Shape | the wordmark as it appears top-right on the paper form |

Anything reasonably large is fine: it is scaled down to fit and never stretched,
so the proportions of the file are kept.

Until a file is here, the PDF header prints `DAC` as plain type with a small
"logo placeholder" note under it — deliberately visible, so a missing logo is
obvious rather than silently blank.

See `src/lib/pdf/data.ts` (`readLogo`) for the lookup, and
`src/components/pdf/booking-form-pdf.tsx` for how it is placed.

## Not used yet

The corner banners on the printed form (blue and red wedges, top-left and
bottom-right) are drawn as shapes rather than images, so they need no asset.
If DAC would rather supply them artwork, that is a Phase 8 change.
