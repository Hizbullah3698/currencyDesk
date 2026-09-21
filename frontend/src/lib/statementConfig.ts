// ---------------------------------------------------------------------------
// The customer statement PDF — every knob in one place
// ---------------------------------------------------------------------------
//
// Nothing about how the statement PDF looks or rounds is decided anywhere else. In particular the
// number of decimals is ONE setting here, not a format string repeated at every call site, because
// whether the client wants whole rupees is an open question for him and answering it must be a
// one-line change rather than a hunt.
//
// `amountDecimals`:
//   2 — exact paisa on every amount. Every column adds up on paper, which a statement handed to a
//       customer has to do. This is the default.
//   0 — whole rupees, rounded half away from zero from the exact paisa figure. Reads more like the
//       client's old system, BUT the columns then add up only to within a rupee or so, because each
//       printed figure is rounded on its own — the very thing that made the old print show a closing
//       balance one rupee away from the sum of its rows. Chosen deliberately, never by accident.
//
// Distances are millimetres on a portrait A4 sheet; type sizes are points. 1 pt = 0.3528 mm.

export type AmountDecimals = 0 | 2

export type RGB = [number, number, number]

const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB

/**
 * THE PALETTE. One brand colour and a handful of neutrals, chosen so that every text-on-background pair
 * is at least 4.5:1 (WCAG AA) — statementConfig.test.ts computes and holds them to it, so a later tweak
 * cannot quietly make the small print unreadable.
 *
 * Brand is the app's own accent, `--color-accent-solid` in index.css, which is what the in-app logo is
 * filled with and what the print stylesheet pins. (The favicon uses a different indigo, #3d46d0; the
 * logo the person sees in the app is the one followed here.) White text on it is 5.17:1, so it needs no
 * darkening for the top band.
 *
 * The tint is the brand at 6% over white, for row striping and the closing row. Printed in black and
 * white it drops to grey level 246 of 255 — faint but visible, which is the intent. Nothing on the page
 * is red or green: colour carries identity and hierarchy, never meaning, so a black-and-white copy loses
 * nothing.
 */
export const PALETTE = {
  brand: '#2563eb',
  /** Brand at 6% over white: striped rows and the closing row. */
  tint: '#f2f6fe',
  /** Digits and other primary text. */
  ink: '#14181f',
  /** The details after a row's type ("500 AED @ 80"). */
  detail: '#4b5563',
  /** Ref, the small Dr/Cr, section labels — lighter and smaller than the detail text. */
  light: '#646b78',
  /** Hairlines: the rule under the table header and above the footer. */
  rule: '#c9ced6',
  white: '#ffffff',
} as const

export const COLOR = {
  brand: rgb(PALETTE.brand),
  tint: rgb(PALETTE.tint),
  ink: rgb(PALETTE.ink),
  detail: rgb(PALETTE.detail),
  light: rgb(PALETTE.light),
  rule: rgb(PALETTE.rule),
  white: rgb(PALETTE.white),
}

export const STATEMENT_CONFIG = {
  /**
   * PLACEHOLDER. Branding comes later; when it does, this becomes real data (a settings row), the
   * same way PrintHeader.tsx explains a business name has to. Until then it is obviously a
   * placeholder rather than an invented company name on a document that gets handed to customers.
   */
  deskName: 'DESK NAME',
  title: 'Statement of Account',
  amountDecimals: 2 as AmountDecimals,

  page: { width: 210, height: 297 },
  margin: { left: 12, right: 12, top: 12, bottom: 14 },

  /** The full-width brand band across the top of page 1. */
  band: {
    height: 20,
    /**
     * Width reserved at the left of the band for a logo. Zero until there is one; when there is, set it
     * and the desk name moves right of it, with nothing else on the page needing to change.
     */
    logoWidth: 0,
  },

  // Column widths add up to the printable width (210 - 12 - 12 = 186).
  columns: { description: 74, ref: 21, debit: 27, credit: 27, balance: 37 },

  // Type sizes, pt. Body is the 8.5-9 pt the brief asks for; small is Ref and the Dr/Cr suffix.
  font: { body: 8.7, small: 6.7, label: 6.3, name: 18, bandName: 14, bandTitle: 10.5, value: 10.5, closingValue: 17, note: 6.6 },

  // Row heights, mm. An entry row is a 16 pt pitch (5.64 mm) — up from ~12.5 pt — because a statement
  // that has to be read should not be set as tightly as a ledger dump.
  row: { entry: 5.64, date: 7.2, opening: 6.6, closing: 8.4, tableHead: 6.4, sectionLabel: 7 },

  /**
   * How many entry rows must sit on the same page as the closing balance. A closing balance that
   * lands alone at the top of a fresh page, with the table it closes left behind, is the fault this
   * document was rebuilt to remove.
   */
  keepWithClosing: 3,
} as const

export type StatementConfig = typeof STATEMENT_CONFIG
