import { ChevronLeft } from 'lucide-react'

export function BackButton({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-border-input bg-surface px-2.5 pr-3 text-meta font-semibold text-muted-70 transition-colors hover:border-accent-border hover:bg-accent-bg hover:text-accent-hover"
    >
      <ChevronLeft size={12} strokeWidth={2.4} />
      <span>{label}</span>
    </button>
  )
}
