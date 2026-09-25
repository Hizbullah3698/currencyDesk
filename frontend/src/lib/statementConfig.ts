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
 * THE PALETTE. A restrained bank-statement look: dark ink on white, one navy accent for headings and the
 * closing figure, and a faint navy-grey shade for the summary and the continuity rows. Every
 * text-on-background pair is at least 4.5:1 (WCAG AA) — statementConfig.test.ts computes and holds them to
 * it, so a later tweak cannot quietly make the small print unreadable.
 *
 * Nothing on the page is red or green, and no meaning is carried by colour alone: a balance's side is
 * always written ("Dr"/"Cr"), so a black-and-white copy loses nothing.
 */
export const PALETTE = {
  /** Navy: headings, the rule under the header, the closing figure. */
  brand: '#1e3a5f',
  /** Brand at 6% over white: the summary box, continuity rows, the closing row. */
  tint: '#f2f3f5',
  /** Figures and primary text. */
  ink: '#111827',
  /** The second line of a row (exchange details, bank, cheque number). */
  detail: '#4b5563',
  /** Labels, voucher numbers, notes — lighter than the detail line, still AA on the tint. */
  light: '#5b6472',
  /** Hairlines between rows and under headings. */
  rule: '#d3d8de',
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
   * The business the statement is from. There is no business-name, address or phone field anywhere in
   * the data model yet (see PrintHeader.tsx), so the name is an obvious PLACEHOLDER rather than an
   * invented company name on a document handed to customers, and the address and phone are empty —
   * which the header omits cleanly. When branding becomes real data (a settings row), it replaces these.
   */
  business: {
    name: 'DESK NAME',
    addressLines: [] as readonly string[],
    phone: '',
  },
  title: 'Statement of Account',
  /**
   * Every customer balance in this app is kept in rupees — receivable/payable are PKR columns and every
   * trade is valued in PKR — so the account currency is a fact of the data model, not a choice.
   */
  accountCurrency: { code: 'PKR', name: 'Pakistani Rupee' },
  amountDecimals: 2 as AmountDecimals,

  page: { width: 210, height: 297 },
  margin: { left: 12, right: 12, top: 12, bottom: 16 },

  // Column widths add up to the printable width (210 - 12 - 12 = 186).
  columns: { date: 22, particulars: 65, voucher: 19, debit: 24, credit: 24, balance: 32 },
  /** Horizontal padding inside a cell. */
  cellPad: 1.5,

  // Type sizes, pt. Transaction text is 10 pt; the second line of a row is a little smaller and grey.
  font: {
    body: 10,
    detail: 8.6,
    date: 9,
    voucher: 8.6,
    side: 8,
    tableHead: 8,
    label: 8,
    value: 11,
    closingValue: 14,
    title: 14,
    section: 11,
    note: 8.3,
    footer: 7.5,
  },

  /** Line pitch as a multiple of the type size. */
  leading: 1.22,
  /** Space above and below the text of a table row, mm. */
  rowPad: 1.4,
  /** Fixed heights, mm. */
  row: { tableHead: 7, continuity: 7, totals: 7.4, sectionHead: 7 },

  /**
   * How many entry rows must sit on the same page as the closing balance. A closing balance that
   * lands alone at the top of a fresh page, with the table it closes left behind, is a fault this
   * document was built to remove.
   */
  keepWithClosing: 3,
  /** The smallest a figure may be shrunk to fit its column before it would be clipped. */
  minFigureSize: 6.5,
} as const

export type StatementConfig = typeof STATEMENT_CONFIG
