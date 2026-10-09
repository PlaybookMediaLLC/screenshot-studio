import { diffStats, diffWords } from '@/lib/launch/diff'
import { cn } from '@/lib/utils'

/** Word-level diff: insertions highlighted, deletions struck through. */
export function DiffView({
  after,
  before,
  className,
  label,
}: {
  after: string
  before: string
  className?: string
  label?: string
}) {
  const parts = diffWords(before, after)
  const stats = diffStats(parts)
  const unchanged = stats.added === 0 && stats.removed === 0
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-neutral-400">{label}</span>
          <span className="text-neutral-600">
            {unchanged ? 'Unchanged' : `+${stats.added} −${stats.removed} words`}
          </span>
        </div>
      ) : null}
      <p className="rounded-lg bg-white/[0.02] px-3 py-2 text-sm leading-6 whitespace-pre-wrap text-neutral-300 ring-1 ring-white/[0.06]">
        {parts.length === 0 ? (
          <span className="text-neutral-600">Empty</span>
        ) : (
          parts.map((part, index) =>
            part.type === 'equal' ? (
              <span key={index}>{part.text}</span>
            ) : part.type === 'insert' ? (
              <ins
                className="rounded-sm bg-emerald-500/15 text-emerald-200 no-underline"
                key={index}
              >
                {part.text}
              </ins>
            ) : (
              <del className="rounded-sm bg-red-500/10 text-red-300/80" key={index}>
                {part.text}
              </del>
            )
          )
        )}
      </p>
    </div>
  )
}
