import type { jsPDF } from 'jspdf'
import { NOTO_SANS_REGULAR } from './fonts/notoSansRegular'
import { NOTO_SANS_SEMIBOLD } from './fonts/notoSansSemiBold'

// ---------------------------------------------------------------------------
// The statement's typeface, embedded in the PDF
// ---------------------------------------------------------------------------
//
// Noto Sans Regular and SemiBold (SIL Open Font License 1.1 — fonts/OFL.txt), embedded rather than
// relying on the standard Helvetica, which is NOT embedded: every viewer and printer substitutes its own
// face with its own widths, so right-aligned figures computed against Helvetica's metrics drift and the
// spacing looks wrong on whatever the substitute is. An embedded face prints the same everywhere.
//
// Its digits are all one width (tabular) by default — the only way to get tabular figures here, since
// jsPDF applies no OpenType features — so a right-aligned column of amounts lines up decimal point over
// decimal point. statementPdf.test.ts measures that rather than trusting this comment.
//
// SUBSET TO EXACTLY WINDOWS-1252 — the same repertoire pdfText.ts allows (printable ASCII, Latin-1 and
// the cp1252 extras such as the euro sign, dashes and curly quotes). So pdfText's rule stays true as
// written: anything it lets through, this font has a glyph for; anything else is replaced and reported
// before the PDF opens. Subsetting keeps each face about 18 KB, and both live only in the lazily loaded
// PDF chunk. Regenerate with fontTools' pyftsubset over that exact set if the font is ever changed.

export const STATEMENT_FONT = 'NotoSans'

export function registerStatementFont(doc: jsPDF): void {
  doc.addFileToVFS('NotoSans-Regular.ttf', NOTO_SANS_REGULAR)
  doc.addFont('NotoSans-Regular.ttf', STATEMENT_FONT, 'normal')
  doc.addFileToVFS('NotoSans-SemiBold.ttf', NOTO_SANS_SEMIBOLD)
  doc.addFont('NotoSans-SemiBold.ttf', STATEMENT_FONT, 'bold')
}
