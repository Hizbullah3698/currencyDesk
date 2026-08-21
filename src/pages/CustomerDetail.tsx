import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowDownCircle, ArrowUpCircle, ArrowUpFromLine, ArrowDownToLine, Inbox, Printer, Pencil, MoreVertical, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { auditLine, relLabel } from '@/lib/engine'
import { fmt } from '@/lib/format'
import { ACTIVITY_META, statusMeta } from '@/lib/ui-helpers'
import { BackButton } from '@/components/BackButton'
import { PrintHeader } from '@/components/PrintHeader'
import { AccountFormModal } from '@/components/AccountFormModal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'

export function CustomerDetail() {
  const { id } = useParams()
  const { state, getAccount, isAdmin, accountHasActivity, archiveAccount, unarchiveAccount, deleteAccount } = useStore()
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)
  const cust = getAccount(id)

  const txns = useMemo(() => (id ? state.activity.filter((t) => t.customerId === id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)) : []), [state.activity, id])

  if (!cust) {
    return (
      <div>
        <BackButton label="All Customers" onBack={() => navigate('/customers')} />
        <div className="mt-6 text-[13px] font-normal text-muted-60">Customer not found.</div>
      </div>
    )
  }

  const receivable = cust.receivable || 0
  const payable = cust.payable || 0
  const openingR = cust.openingReceivable || 0
  const openingP = cust.openingPayable || 0
  const settledR = Math.max(openingR - receivable, 0)
  const settledP = Math.max(openingP - payable, 0)
  const pctR = openingR > 0 ? Math.min(100, Math.round((settledR / openingR) * 100)) : receivable === 0 ? 100 : 0
  const pctP = openingP > 0 ? Math.min(100, Math.round((settledP / openingP) * 100)) : payable === 0 ? 100 : 0

  const hasActivity = accountHasActivity(cust.id)

  function toggleArchive() {
    if (cust!.archived) unarchiveAccount(cust!.id)
    else archiveAccount(cust!.id)
  }
  function removeCustomer() {
    const err = deleteAccount(cust!.id)
    if (!err) navigate('/customers')
  }

  return (
    <div>
      <PrintHeader title={`Customer Statement — ${cust.name}`} period={`All-time · ${txns.length} transaction${txns.length === 1 ? '' : 's'} on file.`} />

      <div className="mb-3 print:hidden">
        <BackButton label="All Customers" onBack={() => navigate('/customers')} />
      </div>
      <div className="mb-3.5 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <h1 className="m-0 text-[19px] font-semibold tracking-tight">{cust.name}</h1>
            {cust.archived && <Badge variant="neutral">Archived</Badge>}
            {isAdmin && (
              <div className="flex items-center gap-0.5 print:hidden">
                <button
                  onClick={() => setEditOpen(true)}
                  aria-label="Edit customer"
                  title="Edit customer"
                  className="rounded-[5px] p-1.5 text-muted-60 transition-colors duration-150 hover:bg-surface-tint hover:text-accent"
                >
                  <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label="More customer actions" title="More actions" className="rounded-[5px] p-1.5 text-muted-60 transition-colors duration-150 hover:bg-surface-tint hover:text-ink">
                      <MoreVertical size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={toggleArchive}>
                      {cust.archived ? <ArchiveRestore size={13} strokeWidth={2} aria-hidden="true" /> : <Archive size={13} strokeWidth={2} aria-hidden="true" />}
                      {cust.archived ? 'Unarchive customer' : 'Archive customer'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      disabled={hasActivity}
                      onSelect={removeCustomer}
                      title={hasActivity ? 'Delete is only available for a customer with zero transactions ever posted.' : undefined}
                    >
                      <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                      Delete customer permanently
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2.5 text-[11px] font-normal text-muted-60">
            <span className="tabular">{cust.phone}</span>
            <span className="text-muted-42" aria-hidden="true">·</span>
            <span>{cust.city}</span>
            <span className="text-muted-42" aria-hidden="true">·</span>
            <span>Customer since {cust.since}</span>
            <span className="text-muted-42" aria-hidden="true">·</span>
            <span>{txns.length} deals</span>
          </div>
          <div className="mt-1 inline-flex cursor-help items-center gap-1 rounded-[5px] p-1.5 text-[10.5px] font-normal text-muted-60 transition-colors duration-150 hover:bg-surface-tint hover:text-accent print:hidden" title={auditLine(cust)}>
            history
          </div>
        </div>
        <div className="flex flex-none gap-2 print:hidden">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={14} strokeWidth={2} aria-hidden="true" />
            Print
          </Button>
          <div className="mx-0.5 w-px bg-border-strong" aria-hidden="true" />
          <Button variant="primary" disabled={receivable <= 0} onClick={() => navigate('/receive', { state: { customerId: cust.id } })}>
            <ArrowDownCircle size={14} strokeWidth={2} aria-hidden="true" />
            Receive Payment
          </Button>
          <Button variant="destructive" disabled={payable <= 0} onClick={() => navigate('/pay', { state: { customerId: cust.id } })}>
            <ArrowUpCircle size={14} strokeWidth={2} aria-hidden="true" />
            Make Payment
          </Button>
          <div className="mx-0.5 w-px bg-border-strong" aria-hidden="true" />
          <Button variant="secondary" onClick={() => navigate('/sale', { state: { customerId: cust.id } })}>
            <ArrowUpFromLine size={14} strokeWidth={2} aria-hidden="true" />
            Sell Currency
          </Button>
          <Button variant="secondary" onClick={() => navigate('/purchase', { state: { customerId: cust.id } })}>
            <ArrowDownToLine size={14} strokeWidth={2} aria-hidden="true" />
            Buy Currency
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card className="overflow-hidden border-l-[3px] border-l-positive print:shadow-none">
          <div className="flex items-center gap-1.5 border-b border-divider px-3.5 py-2.5">
            <div className="h-1.5 w-1.5 rounded-full bg-positive" aria-hidden="true" />
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-70">Receivable — owed to you</div>
          </div>
          <div className="px-3.5 pb-3.5 pt-3">
            <div className="flex items-baseline justify-between py-1">
              <span className="text-[11.5px] font-normal text-muted-70">Original</span>
              <span className="tabular text-[13px] font-normal">{fmt(openingR)}</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-divider py-1">
              <span className="text-[11.5px] font-normal text-muted-70">Settled</span>
              <span className="tabular text-[13px] font-normal text-muted-60">− {fmt(settledR)}</span>
            </div>
            <div className="flex items-baseline justify-between pt-2">
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-60">Remaining</span>
              <span className="tabular text-[24px] font-semibold tracking-tight text-positive">{fmt(receivable)}</span>
            </div>
            <div className="mt-2.5 h-[3px] overflow-hidden rounded-[2px] bg-divider">
              <div className="h-full bg-positive transition-[width] duration-300 ease-out" style={{ width: `${pctR}%` }} />
            </div>
            <div className="mt-1 text-[10px] font-normal text-muted-60">{pctR}% settled</div>
          </div>
        </Card>
        <Card className="overflow-hidden border-l-[3px] border-l-negative print:shadow-none">
          <div className="flex items-center gap-1.5 border-b border-divider px-3.5 py-2.5">
            <div className="h-1.5 w-1.5 rounded-full bg-negative" aria-hidden="true" />
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-70">Payable — you owe</div>
          </div>
          <div className="px-3.5 pb-3.5 pt-3">
            <div className="flex items-baseline justify-between py-1">
              <span className="text-[11.5px] font-normal text-muted-70">Original</span>
              <span className="tabular text-[13px] font-normal">{fmt(openingP)}</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-divider py-1">
              <span className="text-[11.5px] font-normal text-muted-70">Settled</span>
              <span className="tabular text-[13px] font-normal text-muted-60">− {fmt(settledP)}</span>
            </div>
            <div className="flex items-baseline justify-between pt-2">
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-60">Remaining</span>
              <span className="tabular text-[24px] font-semibold tracking-tight text-negative">{fmt(payable)}</span>
            </div>
            <div className="mt-2.5 h-[3px] overflow-hidden rounded-[2px] bg-divider">
              <div className="h-full bg-negative transition-[width] duration-300 ease-out" style={{ width: `${pctP}%` }} />
            </div>
            <div className="mt-1 text-[10px] font-normal text-muted-60">{pctP}% settled</div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden print:shadow-none">
        <div className="flex items-center justify-between border-b border-border px-[13px] py-2.5">
          <div className="text-[12.5px] font-semibold">Transaction history</div>
          <div className="text-[11px] font-normal text-muted-60">{cust.name} only</div>
        </div>
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[86px]">Type</div>
          <div className="flex-1">Detail</div>
          <div className="min-w-[70px]">Status</div>
          <div className="min-w-[110px] text-right">Amount</div>
          <div className="min-w-[62px] text-right">Date</div>
        </div>
        {txns.map((t) => {
          const meta = ACTIVITY_META[t.type]
          const Icon = meta.icon
          const cheque = t.chequeId ? state.cheques.find((q) => q.id === t.chequeId) : undefined
          const statusLabel = cheque ? cheque.status : t.outstanding ? 'Open' : 'Settled'
          const status = statusMeta(statusLabel)
          const StatusIcon = status.icon
          const detail = t.type === 'sale' || t.type === 'purchase' ? `${t.amount?.toLocaleString('en-US')} ${t.currency} @ ${t.rate}` : `via ${t.method}`
          return (
            <div key={t.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2">
              <div className="flex min-w-[102px] items-center gap-1.5">
                <div className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px]" style={{ background: meta.chipBg, color: meta.chipColor }}>
                  <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                </div>
                <span className="text-[12px] font-medium text-ink">{meta.label}</span>
              </div>
              <div className="flex-1 text-[12.5px] font-normal text-muted-70">{detail}</div>
              <div className="min-w-[70px]">
                <Badge variant={status.variant}>
                  <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
                  {statusLabel}
                </Badge>
              </div>
              <div className="tabular min-w-[110px] text-right text-[12.5px] font-medium">{fmt(t.pkrValue)}</div>
              <div className="min-w-[62px] text-right text-[11px] font-normal text-muted-60">{relLabel(t.createdAt)}</div>
            </div>
          )
        })}
      </Card>
      {txns.length === 0 && <EmptyState icon={Inbox} title={`No transactions yet with ${cust.name}.`} className="py-8" />}

      {editOpen && <AccountFormModal mode="edit" editId={cust.id} onClose={() => setEditOpen(false)} />}
    </div>
  )
}
