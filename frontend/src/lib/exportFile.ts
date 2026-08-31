// ---------------------------------------------------------------------------
// File export
// ---------------------------------------------------------------------------
//
// The first export pipeline in this app — there was none to reuse. What DOES exist is a real print
// pipeline (PrintHeader, `print:hidden`, and the @media print block in index.css that forces every
// colour token back to fixed light values), which the balance sheet, income statement and customer
// detail all already lean on. That is reused for PDF rather than duplicated; see printStatement().

/**
 * Escapes one CSV field.
 *
 * The three characters that matter are comma, double-quote and newline. A customer named
 * "Khan, Sons & Co" or a narration containing a line break would otherwise silently shift every
 * subsequent column on that row — a corruption that looks like plausible data rather than an
 * error, which is the worst kind in a financial export.
 */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvField).join(','), ...rows.map((r) => r.map(csvField).join(','))].join('\r\n')
}

/**
 * Triggers a download of `content` as `filename`.
 *
 * The BOM is not decoration. Excel on Windows assumes the system's legacy codepage for a .csv
 * unless one is present, so without it a customer named "Müller" or any non-ASCII narration opens
 * as mojibake — and this desk's data is Pakistani, so that is the normal case rather than an edge
 * one. Sheets and LibreOffice tolerate the BOM, so it costs nothing elsewhere.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Freed on the next tick rather than immediately: revoking synchronously can cancel the download
  // in some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Opens the browser's print dialog for the current page.
 *
 * Used for BOTH "Print" and "Export PDF". That is a deliberate decision, not an omission:
 *
 * This codebase already renders print-quality documents through its @media print stylesheet —
 * fixed light colours regardless of theme, tabular figures, page-break rules that keep a total
 * with its table. Every browser's print dialog offers "Save as PDF" from exactly that rendering.
 *
 * The alternative is a PDF library (jsPDF + an autotable plugin, ~350KB) which would add a SECOND
 * rendering path for the same document — one that has to be kept visually in step with the print
 * stylesheet by hand, and which would land on a bundle already flagged at ~870KB. For a statement
 * whose layout is already solved by CSS, that is a poor trade.
 *
 * Worth revisiting if the client wants PDFs generated server-side (emailed statements, say), which
 * a browser dialog cannot do — that is a different feature, not a better version of this one.
 */
export function printStatement(): void {
  window.print()
}

/** Filename-safe version of a customer name, so "Khan & Sons (Lahore)" cannot produce a path. */
export function safeFilePart(name: string): string {
  return name
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'customer'
}
