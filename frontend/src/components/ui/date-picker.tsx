import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/** Parses a plain 'YYYY-MM-DD' string as a local-midnight Date — appending a bare 'T00:00:00'
 * avoids the classic bug where a date-only string gets parsed as UTC and shifts a day in
 * negative-offset timezones (same fix already applied in lib/format.ts's fmtShortDate). */
function parseISO(v: string): Date | null {
  if (!v) return null
  const d = new Date(v + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function monthGrid(viewDate: Date): { date: Date; inMonth: boolean }[] {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const startDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()
  const cells: { date: Date; inMonth: boolean }[] = []
  for (let i = startDay - 1; i >= 0; i--) cells.push({ date: new Date(year, month - 1, daysInPrevMonth - i), inMonth: false })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d), inMonth: true })
  let next = 1
  while (cells.length < 42) cells.push({ date: new Date(year, month + 1, next++), inMonth: false })
  return cells
}

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function DatePicker({ value, onChange, placeholder = 'Select date', className }: DatePickerProps) {
  const selected = useMemo(() => parseISO(value), [value])
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => selected || new Date())
  const today = new Date()

  function openChange(next: boolean) {
    if (next) setViewDate(selected || new Date())
    setOpen(next)
  }

  function pick(d: Date) {
    onChange(toISO(d))
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-[30px] items-center gap-1.5 rounded-control border border-border-strong bg-surface px-2.5 text-meta text-ink transition-colors duration-150 hover:bg-surface-tint',
            !selected && 'text-muted-60',
            className,
          )}
        >
          <CalendarDays size={13} strokeWidth={2} className="flex-none text-muted-60" aria-hidden="true" />
          {selected ? selected.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : placeholder}
          {selected && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  e.preventDefault()
                  onChange('')
                }
              }}
              className="ml-0.5 flex-none rounded-control p-0.5 text-muted-42 transition-colors duration-150 hover:bg-surface-sunken hover:text-ink"
            >
              <X size={11} strokeWidth={2.4} aria-hidden="true" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[248px]">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
            className="flex h-6 w-6 items-center justify-center rounded-control text-muted-70 transition-colors duration-150 hover:bg-surface-tint hover:text-ink"
          >
            <ChevronLeft size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <span className="text-body font-semibold">{viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
            className="flex h-6 w-6 items-center justify-center rounded-control text-muted-70 transition-colors duration-150 hover:bg-surface-tint hover:text-ink"
          >
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {WEEKDAYS.map((w) => (
            <div key={w} className="flex h-7 items-center justify-center text-meta font-semibold text-muted-60">
              {w}
            </div>
          ))}
          {monthGrid(viewDate).map(({ date, inMonth }, i) => {
            const isSelected = !!selected && sameDay(date, selected)
            const isToday = sameDay(date, today)
            return (
              <button
                key={i}
                type="button"
                onClick={() => pick(date)}
                className={cn(
                  'flex h-7 items-center justify-center rounded-data text-meta font-medium transition-colors duration-150',
                  inMonth ? 'text-ink' : 'text-muted-38',
                  !isSelected && 'hover:bg-surface-tint',
                  isSelected && 'bg-accent-solid font-semibold text-white hover:bg-accent-solid-hover',
                  !isSelected && isToday && 'text-accent',
                )}
              >
                {date.getDate()}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
