import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { matchesQuery } from '@/lib/customerSearch'

// ---------------------------------------------------------------------------
// Combobox — one control that is both a filter and a picker
// ---------------------------------------------------------------------------
//
// Replaces the pattern this app repeated on the trade and settlement screens: a "type to filter"
// text box stacked ON TOP of a separate "select customer" dropdown. Two controls for one decision,
// where the first silently changed the contents of the second and neither showed the current
// answer on its own.
//
// It also solves something a native <select> structurally cannot: the collapsed state and the open
// list showing DIFFERENT text. A native select's closed label is just the selected <option>'s
// text, so "AED" when closed and "AED — UAE Dirham" when open is impossible with one. That is why
// the currency picker moved here too rather than staying native.

export interface ComboboxOption {
  value: string
  /** Shown collapsed, and as the primary text of the row when open. */
  label: string
  /** Secondary text shown ONLY in the open list — the full currency name, a customer's city. */
  hint?: string
}

interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  /** Off for short fixed lists (six currencies) where a search box is more friction than help. */
  searchable?: boolean
  /** Rendered under the list — where the "add a customer" action lives. */
  footer?: ReactNode
  emptyLabel?: string
  className?: string
  id?: string
  'aria-label'?: string
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  searchable = true,
  footer,
  emptyLabel = 'No matches.',
  className,
  id,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  // Uses the app's shared matching rule rather than its own, so this control and the ledger's
  // browsable list cannot start disagreeing about what counts as a match. Searches the hint as
  // well as the label, so someone who knows "Dirham" but not "AED" still finds it — which is the
  // entire reason the hint is shown in the list.
  const filtered = useMemo(() => options.filter((o) => matchesQuery(query, o.label, o.hint)), [options, query])

  // Reopening should not inherit the last search or a stale highlight.
  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const i = filtered.findIndex((o) => o.value === value)
    setActive(i >= 0 ? i : 0)
    // `open` is the trigger; re-running on every keystroke would fight the arrow keys below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep the highlight inside the list as it is filtered down.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

  function commit(option: ComboboxOption) {
    onChange(option.value)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => {
        const next = e.key === 'ArrowDown' ? a + 1 : a - 1
        return Math.max(0, Math.min(next, filtered.length - 1))
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const option = filtered[active]
      if (option) commit(option)
      return
    }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          aria-expanded={open}
          className={cn(
            'flex h-[34px] w-full items-center justify-between gap-2 rounded-control border border-border-input bg-surface px-2.5 text-body transition-colors duration-150',
            'hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
            className,
          )}
        >
          {/* Collapsed shows the LABEL only. Any hint stays in the open list, which is the whole
              point for currencies: "AED" while working, the full name when choosing. */}
          <span className={cn('truncate text-left', selected ? 'text-ink' : 'text-muted-60')}>{selected ? selected.label : placeholder}</span>
          <ChevronDown size={14} className="flex-none text-muted-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0" onKeyDown={onKeyDown}>
        {searchable && (
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
            <Search size={14} className="flex-none text-muted-60" aria-hidden="true" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-7 min-w-0 flex-1 border-none bg-transparent p-0 text-body shadow-none focus-visible:outline-none"
            />
          </div>
        )}

        <div ref={listRef} role="listbox" className="max-h-[240px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-2.5 py-3 text-center text-meta font-normal text-muted-60">{emptyLabel}</div>
          ) : (
            filtered.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(o)}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body transition-colors duration-150',
                  i === active ? 'bg-surface-hover' : 'bg-transparent',
                )}
              >
                <Check size={13} className={cn('flex-none', o.value === value ? 'text-accent' : 'text-transparent')} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{o.label}</span>
                {o.hint && <span className="flex-none truncate text-meta font-normal text-muted-60">{o.hint}</span>}
              </button>
            ))
          )}
        </div>

        {footer && <div className="border-t border-border p-1">{footer}</div>}
      </PopoverContent>
    </Popover>
  )
}
