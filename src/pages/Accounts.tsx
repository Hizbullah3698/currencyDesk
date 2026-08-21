import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { fmt } from '@/lib/format'
import { ACCOUNT_TYPES } from '@/lib/types'
import type { Account, AccountType } from '@/lib/types'
import { Lock, X, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

const BLANK = {
  type: 'Customer' as AccountType,
  name: '',
  phone: '',
  city: '',
  notes: '',
  bankName: '',
  accountNo: '',
  category: '',
  designation: '',
  monthlySalary: '',
  code: 'AED',
  opening: '',
  typeOverride: false,
}

export function Accounts() {
  const { state, isAdmin, saveAccount, deleteAccount, typeLockedFor, typeLockReason, accountHasActivity } = useStore()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'All' | AccountType>('All')
  const [params] = useSearchParams()

  const [open, setOpen] = useState(!!params.get('new'))
  const [mode, setMode] = useState<'new' | 'edit'>('new')
  const [editId, setEditId] = useState('')
  const [form, setForm] = useState({ ...BLANK, type: (params.get('new') as AccountType) || 'Customer' })
  const [error, setError] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.accounts
      .filter((a) => (typeFilter === 'All' ? true : a.type === typeFilter))
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type) || a.name.localeCompare(b.name))
  }, [state.accounts, search, typeFilter])

  function balanceOf(a: Account) {
    if (a.type === 'Customer') return { dr: a.receivable || 0, cr: a.payable || 0 }
    return { dr: 0, cr: 0 }
  }

  function openNew(type: AccountType) {
    setMode('new')
    setEditId('')
    setForm({ ...BLANK, type })
    setError('')
    setOpen(true)
  }
  function openEdit(a: Account) {
    if (!isAdmin) return
    setMode('edit')
    setEditId(a.id)
    setForm({
      type: a.type,
      name: a.name,
      phone: a.phone === '—' ? '' : a.phone || '',
      city: a.city === '—' ? '' : a.city || '',
      notes: a.notes || '',
      bankName: a.bankName || '',
      accountNo: a.accountNo || '',
      category: a.category || '',
      designation: a.designation || '',
      monthlySalary: a.monthlySalary ? String(a.monthlySalary) : '',
      code: a.code || 'AED',
      opening: '',
      typeOverride: false,
    })
    setError('')
    setOpen(true)
  }
  function close() {
    setOpen(false)
    setError('')
  }
  function save() {
    const err = saveAccount(mode, editId, form)
    if (err) return setError(err)
    close()
  }
  function remove() {
    const err = deleteAccount(editId)
    if (err) return setError(err)
    close()
  }

  const editAccount = editId ? state.accounts.find((a) => a.id === editId) : undefined
  const locked = mode === 'edit' && typeLockedFor(editAccount) && !form.typeOverride

  return (
    <div>
      <div className="mb-[18px] flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-tight">Accounts</h1>
          <div className="text-[12px] font-normal text-muted-70">{state.accounts.length} accounts — customers, banks, expenses and equity in one book.</div>
        </div>
        {isAdmin ? (
          <Button variant="primary" className="flex-none px-3.5 py-2" onClick={() => openNew('Customer')}>
            New account
          </Button>
        ) : (
          <div className="flex flex-none items-center gap-1.5 rounded-[6px] border border-locked-border bg-locked-bg px-2.5 py-1.5 text-[11.5px] font-semibold text-locked-text">
            <Lock size={12} strokeWidth={2.4} aria-hidden="true" />
            Read-only — account management is Admin-only
          </div>
        )}
      </div>

      <div className="mb-3.5 flex items-center gap-2.5">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts" className="w-[250px] flex-none" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
          {(['All', ...ACCOUNT_TYPES] as const).map((t) => {
            const count = t === 'All' ? state.accounts.length : state.accounts.filter((a) => a.type === t).length
            const active = typeFilter === t
            return (
              <Button
                key={t}
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={active}
                onClick={() => setTypeFilter(t)}
                className={cn('flex-none gap-1 text-[11.5px]', active && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
              >
                {t}
                <span className="tabular text-[10.5px] opacity-70">{count}</span>
              </Button>
            )
          })}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-0 flex-1">Account</div>
          <div className="min-w-[112px]">Type</div>
          <div className="min-w-0 flex-[1.1]">Detail</div>
          <div className="min-w-[150px] text-right">Balance</div>
          <div className="min-w-[62px] text-right">Status</div>
          <div className="w-3.5" />
        </div>
        {rows.map((a) => {
          const bal = balanceOf(a)
          const inUse = accountHasActivity(a.id)
          return (
            <div key={a.id} onClick={() => openEdit(a)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
              <div className="min-w-0 flex-1 text-[12.5px] font-semibold">{a.name}</div>
              <div className="min-w-[112px] text-[11.5px] font-normal text-muted-70">{a.type}</div>
              <div className="min-w-0 flex-[1.1] truncate text-[11.5px] font-normal text-muted-70">{detailFor(a)}</div>
              <div className="flex min-w-[150px] items-baseline justify-end gap-1.5 text-right">
                {bal.dr > 0 && <span className="tabular text-[12.5px] font-medium text-positive">{fmt(bal.dr)}</span>}
                {bal.cr > 0 && <span className="tabular text-[12.5px] font-medium text-negative">{fmt(bal.cr)}</span>}
                {!bal.dr && !bal.cr && <span className="tabular text-[12.5px] font-normal text-muted-60">—</span>}
              </div>
              <div className="min-w-[62px] text-right">
                <Badge variant={inUse ? 'accent' : 'neutral'}>{inUse ? 'In use' : 'Unused'}</Badge>
              </div>
              <div className="w-3.5 text-muted-42" aria-hidden="true">→</div>
            </div>
          )
        })}
      </Card>
      {rows.length === 0 && <EmptyState icon={SearchX} title="No accounts match this filter." />}

      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/35 px-5 pb-5 pt-[70px]" onClick={close}>
          <Card className="w-full max-w-[440px] overflow-hidden shadow-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
              <div className="text-[13px] font-semibold">{mode === 'new' ? 'New account' : 'Edit account'}</div>
              <button onClick={close} aria-label="Close" className="rounded-[4px] p-1 text-muted-60 transition-colors duration-150 hover:text-ink">
                <X size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-col gap-2.5 p-3.5">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted-70">Account type</label>
                {locked ? (
                  <div className="inline-flex h-[30px] items-center rounded-[6px] border border-border-input bg-surface-sunken px-2.5 text-[12.5px] font-semibold text-muted-70">{form.type}</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {ACCOUNT_TYPES.map((t) => (
                      <Button
                        key={t}
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={mode === 'edit' && !!editAccount?.system}
                        aria-pressed={form.type === t}
                        onClick={() => setForm((f) => ({ ...f, type: t }))}
                        className={cn('text-[11.5px]', form.type === t && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                )}
                {mode === 'edit' && editAccount && typeLockedFor(editAccount) && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-[5px] border border-locked-border bg-locked-bg px-1.5 py-0.5 text-[11px] font-semibold text-locked-text">
                      <Lock size={11} strokeWidth={2.4} aria-hidden="true" />
                      {typeLockReason(editAccount)}
                    </span>
                  </div>
                )}
                {mode === 'edit' && editAccount && !editAccount.system && typeLockedFor(editAccount) && !form.typeOverride && isAdmin && (
                  <Button variant="outlineDestructive" size="sm" className="mt-1.5 border-dashed text-[11.5px]" onClick={() => setForm((f) => ({ ...f, typeOverride: true }))}>
                    Admin override — change type anyway
                  </Button>
                )}
                {form.typeOverride && (
                  <div className="mt-2 rounded-[6px] border border-negative-border border-l-[3px] border-l-negative bg-negative-bg px-2.5 py-2">
                    <div className="mb-0.5 text-[11.5px] font-bold text-negative-deep">Admin override active</div>
                    <div className="text-[11px] font-normal leading-[1.45] text-negative-deep">Only for correcting a data-entry error. The type change is recorded against your name.</div>
                    <Button variant="secondary" size="sm" className="mt-1.5 text-[11.5px]" onClick={() => setForm((f) => ({ ...f, typeOverride: false, type: editAccount?.type || f.type }))}>
                      Cancel override
                    </Button>
                  </div>
                )}
              </div>

              <Field label="Account name">
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-[34px] text-[12.5px]" />
              </Field>

              {(form.type === 'Customer' || form.type === 'Employee') && (
                <div className="grid grid-cols-[1.3fr_1fr] gap-2.5">
                  <Field label="Phone">
                    <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+92 300 0000 000" className="tabular h-[34px] text-[12px]" />
                  </Field>
                  <Field label="City">
                    <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="Lahore" className="h-[34px] text-[12.5px]" />
                  </Field>
                </div>
              )}
              {form.type === 'Bank' && (
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Bank">
                    <Input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="Meezan Bank" className="h-[34px] text-[12.5px]" />
                  </Field>
                  <Field label="Account no.">
                    <Input value={form.accountNo} onChange={(e) => setForm((f) => ({ ...f, accountNo: e.target.value }))} placeholder="0102-4471-9" className="tabular h-[34px] text-[12px]" />
                  </Field>
                </div>
              )}
              {form.type === 'Expense' && (
                <Field label="Expense category">
                  <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Rent, utilities, commission…" className="h-[34px] text-[12.5px]" />
                </Field>
              )}
              {form.type === 'Employee' && (
                <div className="grid grid-cols-[1.2fr_1fr] gap-2.5">
                  <Field label="Designation">
                    <Input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} placeholder="Counter dealer" className="h-[34px] text-[12.5px]" />
                  </Field>
                  <Field label="Monthly salary">
                    <Input value={form.monthlySalary} onChange={(e) => setForm((f) => ({ ...f, monthlySalary: e.target.value }))} placeholder="0" className="tabular h-[34px] text-[12px]" />
                  </Field>
                </div>
              )}
              {form.type === 'Currency Stock' && (
                <Field label="Currency code">
                  <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="AED" className="tabular h-[34px] text-[12px]" />
                  <div className="mt-1.5 text-[11px] font-normal text-muted-60">Quantity and weighted-average cost come from the currency ledger.</div>
                </Field>
              )}
              {mode === 'new' && (form.type === 'Customer' || form.type === 'Payable' || form.type === 'Bank' || form.type === 'Cash') && (
                <Field label="Opening balance">
                  <Input value={form.opening} onChange={(e) => setForm((f) => ({ ...f, opening: e.target.value }))} placeholder="0" className="tabular h-[34px] text-[12px]" />
                  <div className="mt-1.5 text-[11px] font-normal leading-[1.45] text-muted-60">Posted as a journal entry against Opening Balance / Capital, so the Balance Sheet stays square.</div>
                </Field>
              )}
              <Field label="Notes">
                <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Anything worth remembering about this account" className="py-1.5 text-[12.5px]" />
              </Field>
              {error && <div className="text-[12px] font-semibold text-negative">{error}</div>}
              <div className="flex items-center justify-end gap-2 border-t border-divider pt-2.5">
                {mode === 'edit' && editAccount && !editAccount.system && (
                  <Button variant="outlineDestructive" className="mr-auto border-solid" onClick={remove}>
                    Delete
                  </Button>
                )}
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={save}>
                  {mode === 'new' ? 'Create account' : 'Save changes'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function detailFor(a: Account): string {
  if (a.type === 'Bank') return [a.bankName, a.accountNo].filter(Boolean).join(' · ')
  if (a.type === 'Employee') return [a.designation, a.monthlySalary ? `PKR ${a.monthlySalary.toLocaleString('en-US')}/mo` : ''].filter(Boolean).join(' · ')
  if (a.type === 'Currency Stock') return `Currency ${a.code}`
  if (a.type === 'Expense') return a.category || 'General'
  if (a.type === 'Customer') return [a.phone, a.city].filter((x) => x && x !== '—').join(' · ') || '—'
  return a.notes || '—'
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold text-muted-70">{label}</label>
      {children}
    </div>
  )
}
