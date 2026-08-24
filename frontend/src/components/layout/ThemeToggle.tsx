import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'

const OPTIONS: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: 'light', label: 'Light theme', icon: Sun },
  { key: 'dark', label: 'Dark theme', icon: Moon },
  { key: 'system', label: 'Match system theme', icon: Monitor },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="flex flex-none overflow-hidden rounded-[6px] border border-border-strong">
      {OPTIONS.map((o, i) => {
        const active = theme === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => setTheme(o.key)}
            aria-pressed={active}
            aria-label={o.label}
            title={o.label}
            className={cn(
              'flex h-8 w-8 flex-none items-center justify-center transition-[background-color,box-shadow] duration-150 ease-out',
              i > 0 && 'border-l border-border-strong',
              active ? 'bg-accent-solid text-white shadow-xs' : 'bg-surface text-muted-70 hover:bg-surface-tint hover:text-ink',
            )}
          >
            <o.icon size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
