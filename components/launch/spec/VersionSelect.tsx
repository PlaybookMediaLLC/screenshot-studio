'use client'

import { ArrowDown01Icon } from 'hugeicons-react'
import { usePathname, useRouter } from 'next/navigation'
import { Pill } from '@/components/platform-ui'

/** One saved version of a spec or plan, newest first in lists. */
export type VersionOption = {
  changeSummary: string | null
  createdAt: string
  id: string
  origin: string
  status: 'APPROVED' | 'DRAFT' | 'SUPERSEDED'
  version: number
}

const ORIGIN: Record<string, string> = { ai: 'AI draft', human: 'Edited', revision: 'AI revision' }

/** Formatted in UTC so the server and browser render the same text. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function VersionStatus({ status }: { status: VersionOption['status'] }) {
  if (status === 'APPROVED') return <Pill tone="green">Approved</Pill>
  if (status === 'DRAFT') return <Pill>Draft</Pill>
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-neutral-500 ring-1 ring-white/[0.08] ring-inset">
      Superseded
    </span>
  )
}

/** Switches the page between versions through `?version=`; the newest has no parameter. */
export function VersionSelect({
  current,
  versions,
}: {
  current: string
  versions: VersionOption[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <span className="relative inline-flex">
      <select
        aria-label="Version"
        className="h-8 appearance-none rounded-lg bg-white/[0.03] pr-8 pl-3 text-sm text-neutral-200 ring-1 ring-white/[0.08] outline-none hover:bg-white/[0.05] focus-visible:ring-white/25"
        onChange={(event) => {
          const id = event.target.value
          router.push(id === versions[0]?.id ? pathname : `${pathname}?version=${id}`)
        }}
        value={current}
      >
        {versions.map((option) => (
          <option key={option.id} value={option.id}>
            {`v${option.version} · ${ORIGIN[option.origin] ?? option.origin} · ${shortDate(option.createdAt)}${option.status === 'APPROVED' ? ' · Approved' : ''}`}
          </option>
        ))}
      </select>
      <ArrowDown01Icon
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-neutral-500"
        size={14}
      />
    </span>
  )
}
