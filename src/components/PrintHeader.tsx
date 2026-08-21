import { Logo } from '@/components/layout/Logo'

/** Only rendered when printing (`hidden print:block`) — gives a filed/shared page its
 * own title, period, and timestamp so it reads correctly without the app chrome around it. */
export function PrintHeader({ title, period }: { title: string; period?: string }) {
  return (
    <div className="mb-4 hidden border-b border-border-strong pb-2.5 print:block">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Logo size={15} />
          <span className="text-[12.5px] font-semibold tracking-tight">Currency Desk</span>
        </div>
        <span className="text-[10.5px] font-normal text-muted-60">
          Generated on {new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      </div>
      <h1 className="m-0 mt-2.5 text-[16px] font-semibold tracking-tight">{title}</h1>
      {period && <div className="mt-0.5 text-[11px] font-normal text-muted-60">{period}</div>}
    </div>
  )
}
