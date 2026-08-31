import { UserPlus, Lock } from 'lucide-react'
import { useStore } from '@/lib/store'

/**
 * The "add a customer" row inside a customer combobox.
 *
 * NOTE ON SCOPE: this behaviour did not previously exist anywhere in the app — neither trade screen
 * nor settlement screen had any way to create a customer inline. It was asked for as something to
 * *preserve* when merging the two customer controls into one, so it is built here rather than
 * quietly dropped.
 *
 * Gated on isAdmin because the server is: POST /api/accounts is behind requireAdmin, so an Operator
 * pressing this would get a 403 from a control that looked available. Showing the reason is better
 * than either hiding it (leaving them wondering how customers get added) or letting them try and
 * fail.
 */
export function AddCustomerAction({ onAdd }: { onAdd: () => void }) {
  const { isAdmin } = useStore()

  if (!isAdmin) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-meta font-normal text-muted-60">
        <Lock size={12} strokeWidth={2.2} aria-hidden="true" />
        Only an Admin can add a customer.
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-body font-medium text-accent transition-colors duration-150 hover:bg-surface-hover"
    >
      <UserPlus size={13} strokeWidth={2} aria-hidden="true" />
      Add a new customer
    </button>
  )
}
