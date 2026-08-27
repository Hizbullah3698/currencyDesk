import { Logo } from '@/components/layout/Logo'

/**
 * Only rendered when printing (`hidden print:block`) — turns a screen page into a
 * filed document: desk masthead, a rule, the statement title in the report serif,
 * the period it covers, and when it was produced.
 *
 * The name shown is the desk/product name ("Currency Desk"), not the signed-in
 * user and not a configured company name — there is no business-name field
 * anywhere in the data model to read one from, and printing the operator's own
 * display name on a filed financial statement would be wrong. If a real
 * registered business name is ever wanted here, it needs to become real data
 * (a settings row), not a hardcoded string.
 */
export function PrintHeader({ title, period }: { title: string; period?: string }) {
  return (
    <div className="mb-5 hidden print:block">
      <div className="flex items-end justify-between gap-3 border-b-2 border-ink pb-2">
        <div className="flex items-center gap-2">
          <Logo size={20} />
          <div>
            <div className="text-body font-semibold uppercase tracking-[0.14em]">Currency Desk</div>
            <div className="text-meta font-normal text-muted-60">Foreign exchange &amp; settlement ledger</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-meta font-semibold uppercase tracking-wide text-muted-70">{period ? 'Statement period' : 'Document'}</div>
          {period && <div className="text-meta font-normal text-muted-60">{period}</div>}
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h1 className="m-0 font-serif text-report font-normal tracking-tight">{title}</h1>
        <span className="tabular text-meta font-normal text-muted-60">
          Generated {new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      </div>
    </div>
  )
}
