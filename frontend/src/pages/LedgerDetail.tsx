import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Inbox, Printer, FileText, Sheet } from 'lucide-react'
import { useStore } from '@/lib/store'
import { customerLedger, currencyMeta, type LedgerRow } from '@/lib/engine'
import { fmt, fmtAmount, fmtRate, fmtLongDate, fmtShortDate, todayISO } from '@/lib/format'
import { downloadCsv, printStatement, safeFilePart, toCsv } from '@/lib/exportFile'
import { statementRange } from '@/lib/statementRange'
import { BackButton } from '@/components/BackButton'
import { PrintHeader } from '@/components/PrintHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { EmptyState } from '@/components/ui/empty-state'

const TYPE_LABEL: Record<LedgerRow['type'], string> = {
  purchase: 'Buy',
  sale: 'Sell',
  receive: 'Receipt',
  pay: 'Payment',
  cheque: 'Cheque',
}

/**
 * One customer's statement: full history, running balance, and the three outputs.
 *
 * Print, PDF and Excel all read the SAME `ledger` object built below, so a date range narrows all
 * three identically. Exporting a different set of rows from the ones on screen would be a quiet way
 * to hand a customer the wrong statement.
 */
export function LedgerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state, getAccount } = useStore()
  const cust = getAccount(id)

  // Full history by default, as specified. Blank means unbounded on that side.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const ledger = useMemo(() => {
    if (!cust) return null
    // Bounds, not a keep() predicate. Rows before the range fold into the opening balance, rows
    // inside are listed, rows after are ignored — three cases a boolean filter cannot express.
    // The bounds themselves come from lib/statementRange.ts, which ends the "To" day at 23:59:59
    // local — see its comment for the day this page used to drop.
    return customerLedger(cust, state.activity, state.cheques, statementRange(from, to))
  }, [cust, state.activity, state.cheques, from, to])

  if (!cust) {
    return (
      <div className="max-w-[560px]">
        <BackButton label="Customer Ledger" onBack={() => navigate('/ledger')} />
        <EmptyState category="customers" icon={Inbox} title="That customer no longer exists." className="mt-6 py-10" />
      </div>
    )
  }

  const l = ledger!
  const multiCurrency = l.currencies.length > 1
  const rangeLabel = from || to ? `${from ? fmtLongDate(from) : 'Start'} — ${to ? fmtLongDate(to) : fmtLongDate(todayISO())}` : 'Full history'

  function exportExcel() {
    // Raw table, not the formatted statement — the client asked for the data for their own
    // analysis, so this deliberately carries no header block, no totals row and no styling. Same
    // columns as the screen, and the same rows the active date range is showing.
    const headers = ['Date', 'Type', 'Description', 'Currency', 'Amount', 'Rate', 'PKR value', 'Owes desk', 'Desk owes', 'Net balance PKR', 'Running currency units']
    const rows = l.rows.map((r) => [
      r.date,
      TYPE_LABEL[r.type],
      r.description,
      r.currency ?? '',
      r.amount ?? '',
      r.rate ?? '',
      r.pkrValue.toFixed(2),
      r.runningReceivable.toFixed(2),
      r.runningPayable.toFixed(2),
      r.runningNet.toFixed(2),
      r.runningCurrencyUnits ?? '',
    ])
    downloadCsv(`ledger-${safeFilePart(cust!.name)}-${todayISO()}.csv`, toCsv(headers, rows))
  }

  return (
    <div className="max-w-[900px]">
      <div className="mb-3 print:hidden">
        <BackButton label="Customer Ledger" onBack={() => navigate('/ledger')} />
      </div>

      {/* Only rendered on paper. Gives the printed sheet and the PDF a real document header —
          who it is for, what period it covers — which a screenshot of the screen would lack. */}
      <PrintHeader title={`Customer Statement — ${cust.name}`} period={`${rangeLabel} · ${l.rows.length} entr${l.rows.length === 1 ? 'y' : 'ies'}`} />

      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="m-0 text-heading font-semibold">{cust.name}</h1>
          <div className="mt-0.5 text-body text-muted-60">{rangeLabel}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={printStatement}>
            <Printer size={14} strokeWidth={2} aria-hidden="true" />
            Print
          </Button>
          {/* Same action as Print by design — the browser's print dialog offers "Save as PDF" from
              the very stylesheet that already renders this app's reports. See lib/exportFile.ts. */}
          <Button variant="secondary" onClick={printStatement}>
            <FileText size={14} strokeWidth={2} aria-hidden="true" />
            Export PDF
          </Button>
          <Button variant="secondary" onClick={exportExcel}>
            <Sheet size={14} strokeWidth={2} aria-hidden="true" />
            Export Excel
          </Button>
        </div>
      </div>

      <Card variant="flat" className="mb-3 flex flex-wrap items-end gap-3 p-3 print:hidden">
        <div>
          <label className="mb-1 block text-meta font-semibold text-muted-70">From</label>
          <DatePicker value={from} onChange={setFrom} placeholder="Start" className="h-[34px] w-[150px] justify-start border-border-input text-body" />
        </div>
        <div>
          <label className="mb-1 block text-meta font-semibold text-muted-70">To</label>
          <DatePicker value={to} onChange={setTo} placeholder="Today" className="h-[34px] w-[150px] justify-start border-border-input text-body" />
        </div>
        {(from || to) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFrom('')
              setTo('')
            }}
          >
            Full history
          </Button>
        )}
        <div className="ml-auto text-meta font-normal text-muted-60">Print and both exports use this range.</div>
      </Card>

      {/* Per-currency position. Shown whenever the customer has traded at all, and it is the whole
          reason a single "running balance" number would be wrong here: AED and USD are not
          commensurable, so adding them produces a figure that means nothing. */}
      {l.currencies.length > 0 && (
        <Card className="mb-3 overflow-hidden">
          <div className="border-b border-border px-[13px] py-2.5 text-body font-semibold">
            Currency position{multiCurrency ? ` — ${l.currencies.length} currencies, kept separate` : ''}
          </div>
          {l.currencies.map((c) => (
            <div key={c.code} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2">
              <div className="min-w-[70px] text-body font-semibold" title={currencyMeta(c.code).name}>
                {c.code}
              </div>
              <div className="flex-1 text-meta font-normal text-muted-60">
                {c.trades} trade{c.trades === 1 ? '' : 's'}
              </div>
              <div className="tabular min-w-[150px] text-right text-body font-medium">
                {c.units >= 0 ? '+' : ''}
                {fmtAmount(c.units, c.code)} {c.code}
              </div>
              <div className="tabular min-w-[140px] text-right text-body text-muted-70">{fmt(Math.abs(c.pkr))}</div>
            </div>
          ))}
          <div className="px-[13px] py-2 text-meta font-normal leading-[1.5] text-muted-60">
            Net units taken in from this customer, per currency — purchases less sales. Never summed across currencies.
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[76px]">Date</div>
          <div className="min-w-[64px]">Type</div>
          <div className="flex-1">Detail</div>
          <div className="min-w-[110px] text-right">Amount</div>
          <div className="min-w-[86px] text-right">Rate</div>
          <div className="min-w-[110px] text-right">PKR</div>
          <div className="min-w-[130px] text-right">Balance</div>
        </div>

        {/* Opening balance is a real row, not a footnote: without it a narrowed date range would
            show a running balance that appears to start from nothing. */}
        <div className="flex items-center gap-2.5 border-b border-divider bg-surface-sunken px-[13px] py-2 text-body">
          <div className="min-w-[76px] text-muted-60">—</div>
          <div className="min-w-[64px] font-medium text-muted-70">Opening</div>
          <div className="flex-1 font-normal text-muted-60">Balance brought forward</div>
          <div className="min-w-[110px]" />
          <div className="min-w-[86px]" />
          <div className="min-w-[110px]" />
          <div className="tabular min-w-[130px] text-right font-medium">{balanceLabel(l.opening.net)}</div>
        </div>

        {l.rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2 text-body transition-colors duration-150 hover:bg-surface-hover">
            <div className="tabular min-w-[76px] text-meta text-muted-70">{fmtShortDate(r.date)}</div>
            <div className="min-w-[64px] font-medium">{TYPE_LABEL[r.type]}</div>
            <div className="flex-1 font-normal text-muted-70">
              {r.description}
              {/* The per-currency running total sits with its own row rather than in a shared
                  column, so two currencies can never appear to continue one another's sequence. */}
              {r.runningCurrencyUnits !== undefined && r.currency && (
                <span className="ml-1.5 text-meta text-muted-60">
                  · running {fmtAmount(r.runningCurrencyUnits, r.currency)} {r.currency}
                </span>
              )}
            </div>
            <div className="tabular min-w-[110px] text-right">
              {r.amount !== undefined && r.currency ? `${fmtAmount(r.amount, r.currency)} ${r.currency}` : '—'}
            </div>
            <div className="tabular min-w-[86px] text-right text-muted-70">{r.rate !== undefined ? fmtRate(r.rate, r.currency) : '—'}</div>
            <div className="tabular min-w-[110px] text-right">{fmt(r.pkrValue)}</div>
            <div className="tabular min-w-[130px] text-right font-medium">{balanceLabel(r.runningNet)}</div>
          </div>
        ))}

        <div className="flex items-center gap-2.5 border-t-2 border-border-input bg-surface-hover px-[13px] py-2.5 text-body">
          <div className="flex-1 font-bold">Closing balance</div>
          <div className="tabular min-w-[130px] text-right font-bold">{balanceLabel(l.closing.net)}</div>
        </div>
      </Card>

      {l.rows.length === 0 && (
        <EmptyState
          category="customers"
          icon={Inbox}
          title={from || to ? 'No entries in this date range.' : `No transactions yet with ${cust.name}.`}
          className="py-8 print:hidden"
        />
      )}

      <div className="mt-2.5 text-meta font-normal leading-[1.5] text-muted-60">
        A positive balance is owed to the desk; a negative one is owed by the desk. Cheques appear on the day they cleared, which is when they move
        the balance.
      </div>
    </div>
  )
}

/** Signed balance with its direction spelled out, since "5,000" alone does not say who owes whom. */
function balanceLabel(net: number): string {
  if (Math.abs(net) < 0.005) return fmt(0)
  return net > 0 ? `${fmt(net)} Dr` : `${fmt(-net)} Cr`
}
