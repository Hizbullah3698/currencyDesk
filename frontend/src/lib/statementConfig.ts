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
 * THE PALETTE — taken from the approved design reference. Deep teal for the business name, the closing-balance
 * panel and the closing row's text; near-black ink; cool greys for labels and the second line of a row; a
 * blue-grey wash for table heads and the closing row; a fainter one for alternate rows. Every text-on-background
 * pair used is at least 4.5:1 (WCAG AA) — statementConfig.test.ts computes and holds them to it.
 *
 * Nothing on the page is red or green, and no meaning is carried by colour alone: a balance's direction is
 * always written ("You owe", "We owe you", "Dr", "Cr"), so a black-and-white copy loses nothing.
 */
export const PALETTE = {
  /** Deep teal: business name, the balance panel, closing-row text. */
  brand: '#183e46',
  /** Text on the teal panel. */
  onBrand: '#ffffff',
  /** Quieter text on the teal panel: its label, "PKR", the opening balance's label. */
  onBrandMuted: '#b3c7cb',
  /** Table heads and the closing row. */
  tint: '#edf1f4',
  /** Alternate transaction rows. */
  zebra: '#f7f9fa',
  /** Figures and primary text. */
  ink: '#1c2329',
  /** The second line of a row (reference, rate, method) and supporting text. */
  detail: '#5d6873',
  /** Small labels ("ACCOUNT HOLDER"), notes, the footer, the Dr/Cr after a balance. */
  light: '#5f6a75',
  /** Hairlines between rows and under the header. */
  rule: '#dfe4e8',
  white: '#ffffff',
} as const

export const COLOR = {
  brand: rgb(PALETTE.brand),
  onBrand: rgb(PALETTE.onBrand),
  onBrandMuted: rgb(PALETTE.onBrandMuted),
  tint: rgb(PALETTE.tint),
  zebra: rgb(PALETTE.zebra),
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
    /** A short line under the name. Empty until the business states one — nothing is invented. */
    tagline: '',
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
  margin: { left: 13, right: 13, top: 13, bottom: 17 },

  // Column widths add up to the printable width (210 - 13 - 13 = 184), in the design reference's proportions.
  // The reference sits UNDER the description, so there is no Reference column. `date` is the narrowest the
  // Date column may be: it widens to fit the longest date actually printed ("30 Dec 2025" on a statement that
  // crosses a year), taking the room from the description, never from the amounts — so 8-digit PKR figures
  // and bold totals stay at full size on one line.
  columns: { date: 19, particulars: 64, debit: 31, credit: 32, balance: 38 },
  /** Horizontal padding inside a cell. */
  cellPad: 3,
  /** Extra clear space kept between the end of the particulars text and the Debit column. */
  particularsGap: 2,

  // Type sizes, pt.
  font: {
    business: 20,
    tagline: 10,
    title: 17,
    period: 10,
    label: 8,
    customer: 16,
    account: 10,
    panelLabel: 8,
    panelDirection: 12,
    panelCurrency: 16,
    balance: 24,
    panelOpeningLabel: 9.5,
    panelOpeningValue: 11,
    section: 12.5,
    note: 9,
    tableHead: 9,
    body: 10.5,
    secondary: 9,
    footer: 8,
  },
  /** Letter spacing for the small upper-case labels, mm. The design tracks them; body text is never tracked. */
  labelTracking: 0.25,

  /** Line pitch as a multiple of the type size. */
  leading: 1.22,
  /** Space above and below the text of a table row, mm. Generous, as in the design. */
  rowPad: 3.4,
  /** Fixed heights, mm. */
  row: { tableHead: 10, continuity: 9, totals: 11, closing: 11, sectionHead: 9 },
  /** The closing-balance panel: height, inner padding and corner radius, mm. */
  panel: { height: 28, pad: 6.5, radius: 1.8 },

  /**
   * How many entry rows must sit on the same page as the totals and closing balance. A closing balance that
   * lands alone at the top of a fresh page, with the table it closes left behind, is a fault this
   * document was built to remove.
   */
  keepWithClosing: 3,
  /** ...or fewer, once the rows kept are this tall (mm): three long wrapped rows need not all travel. */
  keepWithClosingHeight: 45,
  /** The smallest a figure may be shrunk to fit its column before it would be clipped. */
  minFigureSize: 6.5,
} as const

export type StatementConfig = typeof STATEMENT_CONFIG
