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
// Distances are millimetres on a portrait A4 sheet.

export type AmountDecimals = 0 | 2

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

  // Column widths add up to the printable width (210 - 12 - 12 = 186).
  columns: { description: 78, ref: 20, debit: 27, credit: 27, balance: 34 },

  font: { body: 7.6, small: 6.6, tiny: 6, heading: 15, sub: 9, summaryValue: 10 },
  row: { entry: 4.4, date: 5.0, opening: 5.2, closing: 6.2, tableHead: 5.6 },

  /**
   * How many entry rows must sit on the same page as the closing balance. A closing balance that
   * lands alone at the top of a fresh page, with the table it closes left behind, is the fault this
   * document was rebuilt to remove.
   */
  keepWithClosing: 3,
} as const

export type StatementConfig = typeof STATEMENT_CONFIG
