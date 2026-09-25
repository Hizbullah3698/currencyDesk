import type { jsPDF } from 'jspdf'
import { INTER_REGULAR } from './fonts/interRegular'
import { INTER_SEMIBOLD } from './fonts/interSemiBold'

// ---------------------------------------------------------------------------
// The statement's typeface, embedded in the PDF
// ---------------------------------------------------------------------------
//
// Inter Regular and SemiBold (SIL Open Font License 1.1 — fonts/OFL.txt), the face of the approved design
// reference. Embedded rather than relying on the standard Helvetica, which is NOT embedded: every viewer
// and printer substitutes its own face with its own widths, so right-aligned figures drift.
//
// TABULAR FIGURES, AND ONLY FIGURES. Inter's default digits are proportional; its tabular digits are the
// `zero.tf`...`nine.tf` glyphs behind the OpenType `tnum` feature, which jsPDF cannot switch on. So the
// font's character map was edited to point the ten digit characters 0-9 at those glyphs — and NOTHING else.
// (A general "feature freezer" was tried first: it also remapped the hyphen to a digit-wide one, printing
// "JV - 022", and narrowed the space, pushing words together. Hence the narrow, hand-made remap.) Every digit
// is then one width, so a right-aligned column of amounts lines up decimal point over decimal point, while
// spaces, hyphens and punctuation keep Inter's own widths. statementPdf.test.ts measures both.

// SUBSET TO EXACTLY WINDOWS-1252 — the repertoire pdfText.ts allows — so pdfText's rule stays true: what
// it lets through, this font can draw; anything else is replaced and reported before the PDF opens. (The
// one cp1252 character Inter lacks, the invisible soft hyphen, is removed by pdfText's tidy-up.) Each face
// is about 19 KB and lives only in the lazily loaded PDF chunk. To rebuild: download the static Inter
// instances, map U+0030-0039 to zero.tf...nine.tf in every Unicode cmap, then pyftsubset over that exact set
// with layout features dropped.

export const STATEMENT_FONT = 'Inter'

export function registerStatementFont(doc: jsPDF): void {
  doc.addFileToVFS('Inter-Regular.ttf', INTER_REGULAR)
  doc.addFont('Inter-Regular.ttf', STATEMENT_FONT, 'normal')
  doc.addFileToVFS('Inter-SemiBold.ttf', INTER_SEMIBOLD)
  doc.addFont('Inter-SemiBold.ttf', STATEMENT_FONT, 'bold')
}
