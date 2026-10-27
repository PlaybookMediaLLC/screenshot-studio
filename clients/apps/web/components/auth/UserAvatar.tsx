import { cn } from '@/lib/utils'

/** The signed-in person's identity; workspace marks remain square and separately labelled. */
export function UserAvatar({ name, image, className }: { name: string; image?: string | null; className?: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return image ? <img alt="" src={image} className={cn('size-8 shrink-0 rounded-full object-cover', className)} /> :
    <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-700 dark:text-violet-200', className)}>{initial}</span>
}
