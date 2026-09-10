import type { ComponentType } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ArrowDownCircle, ArrowUpCircle, Banknote, SquarePen, Clock, CheckCircle2, XCircle, Landmark, AlertTriangle } from 'lucide-react'
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

export type StatusBadgeVariant = 'neutral' | 'positive' | 'negative' | 'pending' | 'accent'

export interface StatusMeta {
  variant: StatusBadgeVariant
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
}

/**
 * Every status word used anywhere in the app (cheque lifecycle, settlement state,
 * salary accrual, journal/ledger balance) maps to one badge variant + icon here,
 * so the same word always renders the same way no matter which screen it's on.
 * Icon choice must echo the variant's existing meaning, never add a new signal:
 * pending = Clock (waiting), positive = CheckCircle2 (done), negative = XCircle/AlertTriangle
 * (stopped / needs attention), accent = Landmark (in transit at the bank).
 */
export const STATUS_META: Record<string, StatusMeta> = {
  Pending: { variant: 'pending', icon: Clock },
  Deposited: { variant: 'accent', icon: Landmark },
  Cleared: { variant: 'positive', icon: CheckCircle2 },
  Returned: { variant: 'negative', icon: XCircle },
  Open: { variant: 'pending', icon: Clock },
  Settled: { variant: 'positive', icon: CheckCircle2 },
  Posted: { variant: 'positive', icon: CheckCircle2 },
  Accrued: { variant: 'positive', icon: CheckCircle2 },
  'Not accrued': { variant: 'pending', icon: Clock },
  Balanced: { variant: 'positive', icon: CheckCircle2 },
  'Not balanced': { variant: 'pending', icon: AlertTriangle },
  'Out of balance': { variant: 'negative', icon: AlertTriangle },
}

export function statusMeta(status: ChequeStatus | string): StatusMeta {
  return STATUS_META[status] || { variant: 'neutral', icon: Clock }
}

export type Category = 'fx' | 'bank' | 'customers' | 'cheques' | 'salary' | 'reports' | 'neutral'

export interface CategoryColor {
  bg: string
  color: string
}

/**
 * Category identity, used ONLY as a soft-tinted icon-badge background (dashboard
 * stat-tile icons, sidebar nav icons, Balance Sheet section headers). Never applied
 * to card backgrounds or to numeric values — the green/red/amber state rule (positive/
 * negative/pending) is a separate system and is untouched by this map.
 */
export const CATEGORY_COLORS: Record<Category, CategoryColor> = {
  fx: { bg: 'var(--color-accent-bg)', color: 'var(--color-accent)' },
  bank: { bg: 'var(--color-cat-blue-bg)', color: 'var(--color-cat-blue)' },
  customers: { bg: 'var(--color-cat-teal-bg)', color: 'var(--color-cat-teal)' },
  cheques: { bg: 'var(--color-pending-bg)', color: 'var(--color-pending)' },
  salary: { bg: 'var(--color-cat-violet-bg)', color: 'var(--color-cat-violet)' },
  reports: { bg: 'var(--color-cat-slate-bg)', color: 'var(--color-cat-slate)' },
  neutral: { bg: 'var(--color-neutral-chip)', color: 'var(--color-muted-70)' },
}

/**
 * Same category identity as CATEGORY_COLORS, but pinned to fixed tokens tuned
 * for the Sidebar's permanent dark-navy background (see index.css) instead
 * of the theme-reactive tokens above — those go nearly invisible on a fixed
 * dark surface while the app is in light mode. Sidebar.tsx only.
 */
export const SIDEBAR_CATEGORY_COLORS: Record<Category, CategoryColor> = {
  fx: { bg: 'var(--color-sidebar-cat-fx-bg)', color: 'var(--color-sidebar-cat-fx)' },
  bank: { bg: 'var(--color-sidebar-cat-bank-bg)', color: 'var(--color-sidebar-cat-bank)' },
  customers: { bg: 'var(--color-sidebar-cat-customers-bg)', color: 'var(--color-sidebar-cat-customers)' },
  cheques: { bg: 'var(--color-sidebar-cat-cheques-bg)', color: 'var(--color-sidebar-cat-cheques)' },
  salary: { bg: 'var(--color-sidebar-cat-salary-bg)', color: 'var(--color-sidebar-cat-salary)' },
  reports: { bg: 'var(--color-sidebar-cat-reports-bg)', color: 'var(--color-sidebar-cat-reports)' },
  neutral: { bg: 'var(--color-sidebar-cat-neutral-bg)', color: 'var(--color-sidebar-cat-neutral)' },
}
