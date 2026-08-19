import type { ComponentType } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ArrowDownCircle, ArrowUpCircle, Banknote, SquarePen } from 'lucide-react'
import type { ActivityType, ChequeStatus } from './types'

export interface TypeMeta {
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  chipBg: string
  chipColor: string
}

export const ACTIVITY_META: Record<ActivityType, TypeMeta> = {
  purchase: { label: 'Purchase', icon: ArrowDownToLine, chipBg: 'var(--color-accent-bg)', chipColor: 'var(--color-accent)' },
  sale: { label: 'Sale', icon: ArrowUpFromLine, chipBg: 'var(--color-positive-bg)', chipColor: 'var(--color-positive)' },
  receive: { label: 'Receive', icon: ArrowDownCircle, chipBg: 'var(--color-positive-bg)', chipColor: 'var(--color-positive)' },
  pay: { label: 'Payment', icon: ArrowUpCircle, chipBg: 'var(--color-negative-bg)', chipColor: 'var(--color-negative)' },
}

export const CHEQUE_META: TypeMeta = { label: 'Cheque', icon: Banknote, chipBg: 'var(--color-pending-bg)', chipColor: 'var(--color-pending)' }
export const JOURNAL_META: TypeMeta = { label: 'Journal', icon: SquarePen, chipBg: 'var(--color-neutral-chip)', chipColor: 'var(--color-muted-70)' }

export const CHEQUE_STATUS_STYLE: Record<ChequeStatus, { bg: string; color: string }> = {
  Pending: { bg: 'var(--color-pending-bg)', color: 'var(--color-pending)' },
  Deposited: { bg: 'var(--color-accent-bg)', color: 'var(--color-accent)' },
  Cleared: { bg: 'var(--color-positive-bg)', color: 'var(--color-positive)' },
  Returned: { bg: 'var(--color-negative-bg)', color: 'var(--color-negative)' },
}

export function activityLabel(type: ActivityType): string {
  return ACTIVITY_META[type].label
}
