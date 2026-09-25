// ---------------------------------------------------------------------------
// Text the PDF's built-in font can actually print
// ---------------------------------------------------------------------------
//
// The statement's embedded font (statementFont.ts) is subset to EXACTLY the Windows-1252 repertoire
// below, so this rule is what it can print. The rule predates it: jsPDF's standard fonts (Helvetica,
// Courier, Times) encode text as Windows-1252, and anything outside that was printed as the WRONG
// glyphs — measured on jsPDF 4.2.1, Arabic and Urdu names came out as a run of unrelated accented
// letters, an arrow ("→") as `!'`, the whole line letter-spaced as if broken. Change the rule and the
// font subset together, or not at all. A statement that silently prints a customer's name as gibberish
// is worse than one that refuses, so unsupported characters are replaced with `?` and — the part that
// matters — REPORTED, so the app can tell the person before the PDF opens.
//
// No library used here shapes right-to-left scripts either, so embedding a font would not fix Arabic
// or Urdu; this is a limit to warn about, not to paper over.

/** The Windows-1252 characters above ASCII/Latin-1 that are worth allowing. */
const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'

/** True when the standard PDF font prints this character correctly. */
export function isPdfSafeChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  if (c >= 0x20 && c <= 0x7e) return true
  if (c >= 0xa0 && c <= 0xff) return true
  return WIN_ANSI_EXTRAS.includes(ch)
}

/** One field whose text had to be changed to be printable. */
export interface TextWarning {
  /** Where it came from, in words a person recognises — "Customer name", "Entry narration JV-016". */
  field: string
  /** The characters that could not be printed, each once, in order of appearance. */
  characters: string[]
  /** What the field printed as. */
  printedAs: string
}

/**
 * Makes `input` safe to print and records a warning when anything had to change.
 *
 * Whitespace is normalised first (newlines and runs of spaces become one space) — that is a tidy-up,
 * not a loss, and is not reported. Then each unsupported character becomes `?`. Iterates by code
 * point so an emoji or a character outside the BMP is ONE replacement, not two.
 */
export function pdfText(input: string | null | undefined, field: string, warnings: TextWarning[]): string {
  // A soft hyphen (U+00AD) is invisible by definition and the embedded font has no glyph for it: dropped.
  const tidy = (input ?? '').replace(/­/g, '').replace(/\s+/g, ' ').trim()
  let out = ''
  const bad: string[] = []
  for (const ch of tidy) {
    if (isPdfSafeChar(ch)) out += ch
    else {
      out += '?'
      if (!bad.includes(ch)) bad.push(ch)
    }
  }
  if (bad.length > 0) {
    // One warning per field even if the same field is asked for twice (a description is measured and
    // then drawn), so the person is told once.
    const existing = warnings.find((w) => w.field === field)
    if (existing) {
      for (const b of bad) if (!existing.characters.includes(b)) existing.characters.push(b)
      existing.printedAs = out
    } else warnings.push({ field, characters: bad, printedAs: out })
  }
  return out
}

/**
 * Text WE generate — labels, fixed descriptions — must never need the warning. A guard for tests and
 * for anyone adding wording: throws if a string of our own contains a character the font cannot print.
 * ("to", not an arrow.)
 */
export function assertPdfSafeLiteral(text: string): string {
  for (const ch of text) {
    if (!isPdfSafeChar(ch)) throw new Error(`Statement wording contains "${ch}" (U+${(ch.codePointAt(0) ?? 0).toString(16)}), which the PDF font cannot print.`)
  }
  return text
}
