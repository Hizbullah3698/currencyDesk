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
 * THE PALETTE. A restrained printable-document look: dark ink on white, ONE blue accent for the business
 * name, section titles and the thin rule under the header, and a very light grey for table headings and the
 * summary area. Every text-on-background pair is at least 4.5:1 (WCAG AA) — statementConfig.test.ts computes
 * and holds them to it, so a later tweak cannot quietly make the small print unreadable.
 *
 * The blue is the app's own accent, `--color-accent-solid` in index.css — what the in-app logo is filled with —
 * so the statement and the app agree. It is 5.17:1 on white.
 *
 * Nothing on the page is red or green, and no meaning is carried by colour alone: a balance's direction is
 * always written ("You owe", "We owe you", "Dr", "Cr"), so a black-and-white copy loses nothing.
 */
export const PALETTE = {
  /** Blue: the business name, section titles and the header rule. Never carries meaning. */
  brand: '#2563eb',
  /** Very light grey: table headings, the summary area, continuity rows. */
  tint: '#f4f5f7',
  /** Figures and primary text. */
  ink: '#111827',
  /** The second line of a row (rate, bank, cheque number) and other supporting text. */
  detail: '#4b5563',
  /** Labels, references and notes — lighter than the detail line, still AA on the tint. */
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
   * The business the statement is from. There is no business-name, address or phone field anywhere in the
   * data model yet (see PrintHeader.tsx), so identity is configured HERE: the name the desk trades under,
   * and address and phone left empty — the header omits empty contact details rather than inventing any.
   * When branding becomes real data (a settings row), it replaces this block and nothing else changes.
   * "Currency Desk" is written as two words on purpose, matching the app's own masthead.
   */
  business: {
    name: 'Currency Desk',
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
  columns: { date: 22, particulars: 61, reference: 21, debit: 26, credit: 26, balance: 30 },
  /** Horizontal padding inside a cell. */
  cellPad: 1.5,
  /** Extra clear space kept between the end of the particulars text and the Reference column. */
  particularsGap: 3,

  // Type sizes, pt. Transaction text is 10 pt; secondary lines 9 pt; the main balance 20 pt.
  font: {
    business: 18,
    title: 16,
    customer: 16,
    body: 10,
    secondary: 9,
    reference: 9,
    side: 8.5,
    tableHead: 9,
    label: 9,
    note: 9,
    section: 12,
    direction: 12,
    balance: 20,
    footer: 8.5,
  },

  /** Line pitch as a multiple of the type size. */
  leading: 1.22,
  /** Space above and below the text of a table row, mm. */
  rowPad: 1.4,
  /** Fixed heights, mm. */
  row: { tableHead: 7.4, continuity: 7, totals: 7.4, closing: 8, sectionHead: 7.5 },

  /**
   * How many entry rows must sit on the same page as the totals and closing balance. A closing balance that
   * lands alone at the top of a fresh page, with the table it closes left behind, is a fault this
   * document was built to remove.
   */
  keepWithClosing: 3,
  /** The smallest a figure may be shrunk to fit its column before it would be clipped. */
  minFigureSize: 6.5,
} as const

export type StatementConfig = typeof STATEMENT_CONFIG
