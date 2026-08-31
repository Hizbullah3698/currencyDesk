import { useState } from 'react'
import { Lock, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { CORE_ACCOUNT_IDS, CURRENCY_LIST } from '@/lib/engine'
import { ACCOUNT_TYPES } from '@/lib/types'
import type { Account, AccountType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { cn } from '@/lib/utils'

const BLANK = {
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

function initialForm(mode: 'new' | 'edit', editAccount: Account | undefined, defaultType: AccountType) {
  if (mode === 'edit' && editAccount) {
    return {
      ...BLANK,
      type: editAccount.type,
      name: editAccount.name,
      phone: editAccount.phone === '—' ? '' : editAccount.phone || '',
      city: editAccount.city === '—' ? '' : editAccount.city || '',
      notes: editAccount.notes || '',
      bankName: editAccount.bankName || '',
      accountNo: editAccount.accountNo || '',
      category: editAccount.category || '',
      designation: editAccount.designation || '',
      monthlySalary: editAccount.monthlySalary ? String(editAccount.monthlySalary) : '',
      code: editAccount.code || 'AED',
    }
  }
  return { ...BLANK, type: defaultType }
}

/** The one type-aware account form, shared by the Accounts list and the customer detail
 * page's edit pencil — same fields, same validation, same type-lock rules, everywhere it opens. */
export function AccountFormModal({ mode, editId = '', defaultType = 'Customer', onClose }: { mode: 'new' | 'edit'; editId?: string; defaultType?: AccountType; onClose: () => void }) {
  const { state, isAdmin, saveAccount, deleteAccount, typeLockedFor, typeLockReason } = useStore()
  const editAccount = editId ? state.accounts.find((a) => a.id === editId) : undefined
  const [form, setForm] = useState(() => initialForm(mode, editAccount, defaultType))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const err = await saveAccount(mode, editId, form)
    setBusy(false)
    if (err) return setError(err)
    onClose()
  }
  async function remove() {
    setBusy(true)
    const err = await deleteAccount(editId)
    setBusy(false)
    if (err) return setError(err)
    onClose()
  }

  const locked = mode === 'edit' && typeLockedFor(editAccount) && !form.typeOverride

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/35 px-5 pb-5 pt-[70px]" onClick={onClose}>
      <Card className="w-full max-w-[440px] overflow-hidden shadow-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <div className="text-body font-semibold">{mode === 'new' ? 'New account' : 'Edit account'}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-control p-1 text-muted-60 transition-colors duration-150 hover:text-ink">
            <X size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-2.5 p-3.5">
          <div>
            <label className="mb-1 block text-meta font-semibold text-muted-70">Account type</label>
            {locked ? (
              <div className="inline-flex h-[30px] items-center rounded-control border border-border-input bg-surface-sunken px-2.5 text-body font-semibold text-muted-70">{form.type}</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {ACCOUNT_TYPES.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={mode === 'edit' && !!editAccount && CORE_ACCOUNT_IDS.includes(editAccount.id)}
                    aria-pressed={form.type === t}
                    onClick={() => setForm((f) => ({ ...f, type: t }))}
                    className={cn('text-meta', form.type === t && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            )}
            {mode === 'edit' && editAccount && typeLockedFor(editAccount) && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-data border border-locked-border bg-locked-bg px-1.5 py-0.5 text-meta font-semibold text-locked-text">
                  <Lock size={11} strokeWidth={2.4} aria-hidden="true" />
                  {typeLockReason(editAccount)}
                </span>
              </div>
            )}
            {mode === 'edit' && editAccount && !CORE_ACCOUNT_IDS.includes(editAccount.id) && typeLockedFor(editAccount) && !form.typeOverride && isAdmin && (
              <Button variant="outlineDestructive" size="sm" className="mt-1.5 border-dashed text-meta" onClick={() => setForm((f) => ({ ...f, typeOverride: true }))}>
                Admin override — change type anyway
              </Button>
            )}
            {form.typeOverride && (
              <div className="mt-2 rounded-control border border-negative-border border-l-[3px] border-l-negative bg-negative-bg px-2.5 py-2">
                <div className="mb-0.5 text-meta font-bold text-negative-deep">Admin override active</div>
                <div className="text-meta font-normal leading-[1.45] text-negative-deep">Only for correcting a data-entry error. The type change is recorded against your name.</div>
                <Button variant="secondary" size="sm" className="mt-1.5 text-meta" onClick={() => setForm((f) => ({ ...f, typeOverride: false, type: editAccount?.type || f.type }))}>
                  Cancel override
                </Button>
              </div>
            )}
          </div>

          <Field label="Account name">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-[34px] text-body" />
          </Field>

          {(form.type === 'Customer' || form.type === 'Employee') && (
            <div className="grid grid-cols-[1.3fr_1fr] gap-2.5">
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+92 300 0000 000" className="tabular h-[34px] text-body" />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="Lahore" className="h-[34px] text-body" />
              </Field>
            </div>
          )}
          {form.type === 'Bank' && (
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Bank">
                <Input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="Meezan Bank" className="h-[34px] text-body" />
              </Field>
              <Field label="Account no.">
                <Input value={form.accountNo} onChange={(e) => setForm((f) => ({ ...f, accountNo: e.target.value }))} placeholder="0102-4471-9" className="tabular h-[34px] text-body" />
              </Field>
            </div>
          )}
          {form.type === 'Expense' && (
            <Field label="Expense category">
              <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Rent, utilities, commission…" className="h-[34px] text-body" />
            </Field>
          )}
          {form.type === 'Employee' && (
            <div className="grid grid-cols-[1.2fr_1fr] gap-2.5">
              <Field label="Designation">
                <Input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} placeholder="Counter dealer" className="h-[34px] text-body" />
              </Field>
              <Field label="Monthly salary">
                <Input value={form.monthlySalary} onChange={(e) => setForm((f) => ({ ...f, monthlySalary: e.target.value }))} placeholder="0" className="tabular h-[34px] text-body" />
              </Field>
            </div>
          )}
          {form.type === 'Currency Stock' && (
            <Field label="Currency">
              {/* A picker, not free text: this code is what joins the account to a stock_positions
                  row, so a typo silently values the account against the wrong position and two
                  accounts sharing a code double-count that stock on the Balance Sheet. The server
                  rejects both cases too — this just stops them being reachable by hand. */}
              {/* Same control as the trade screens: code collapsed, full name in the open list. */}
              <Combobox
                value={form.code}
                onChange={(code) => setForm((f) => ({ ...f, code }))}
                options={CURRENCY_LIST.map((c) => ({ value: c.code, label: c.code, hint: c.name }))}
                searchable={false}
                aria-label="Currency"
              />
              <div className="mt-1.5 text-meta font-normal text-muted-60">One stock account per traded currency. Quantity and weighted-average cost come from the currency ledger.</div>
            </Field>
          )}
          {mode === 'new' && (form.type === 'Customer' || form.type === 'Payable' || form.type === 'Bank' || form.type === 'Cash') && (
            <Field label="Opening balance">
              <Input value={form.opening} onChange={(e) => setForm((f) => ({ ...f, opening: e.target.value }))} placeholder="0" className="tabular h-[34px] text-body" />
              <div className="mt-1.5 text-meta font-normal leading-[1.45] text-muted-60">Posted as a journal entry against Opening Balance / Capital, so the Balance Sheet stays square.</div>
            </Field>
          )}
          <Field label="Notes">
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Anything worth remembering about this account" className="py-1.5 text-body" />
          </Field>
          {error && <div className="text-body font-semibold text-negative">{error}</div>}
          <div className="flex items-center justify-end gap-2 border-t border-divider pt-2.5">
            {mode === 'edit' && editAccount && !CORE_ACCOUNT_IDS.includes(editAccount.id) && (
              <Button variant="outlineDestructive" className="mr-auto border-solid" disabled={busy} onClick={remove}>
                Delete
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : mode === 'new' ? 'Create account' : 'Save changes'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-meta font-semibold text-muted-70">{label}</label>
      {children}
    </div>
  )
}
