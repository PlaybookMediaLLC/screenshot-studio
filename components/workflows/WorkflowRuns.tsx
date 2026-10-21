'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getErrorMessage } from '@/components/workspace/settings-client'
import {
  automationFamilySchema,
  type AutomationHistoryItem,
  type AutomationOverview,
} from '@/lib/api/contracts/release-automation'
import {
  automationHistoryFilterSchema,
  automationRunStatusSchema,
  type AutomationHistoryFilter,
} from '@/lib/api/contracts/workflow-runs'
import { useTRPCClient } from '@/lib/trpc/react'
import { runDateBoundary, runDateDay, runHandler } from '@/lib/workflows/history'
import { FAMILY_NAMES } from './workflow-canvas'
import {
  duration,
  FAILURE_CODES,
  RunStatusPill,
  runActive,
  runStatusLabel,
  triggeringObject,
} from './workflow-ui'

const ALL = 'all'

/** Persisted run history with workflow, event, repository, status, and date filters. */
export function WorkflowRuns() {
  const client = useTRPCClient()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const parsed = useMemo(
    () =>
      automationHistoryFilterSchema.safeParse(
        Object.fromEntries([...params].filter(([, value]) => value))
      ),
    [params]
  )
  const filter: AutomationHistoryFilter = useMemo(
    () => (parsed.success ? parsed.data : {}),
    [parsed]
  )
  const filterError = parsed.success
    ? null
    : parsed.error.issues.map((issue) => issue.message).join(' ')
  const [overview, setOverview] = useState<AutomationOverview | null>(null)
  const [items, setItems] = useState<AutomationHistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const before = filter.before
  const request = useRef(0)

  const load = useCallback(async () => {
    const current = ++request.current
    if (filterError) {
      setError(`${filterError} Clear filters to choose a valid range.`)
      setItems([])
      return
    }
    try {
      const [next, history] = await Promise.all([
        client.releaseAutomation.overview.query(),
        client.releaseAutomation.history.query({ ...filter, before }),
      ])
      if (current !== request.current) return
      setOverview(next)
      setItems(history.items)
      setError(null)
    } catch (failure) {
      if (current === request.current) setError(getErrorMessage(failure))
    }
  }, [client, filter, before, filterError])
  useEffect(() => {
    void load()
    // Refresh the newest page while it is open; older pages are stable.
    const timer = before ? undefined : setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load, before])

  function setFilter(
    keys: keyof AutomationHistoryFilter | (keyof AutomationHistoryFilter)[],
    value: string
  ) {
    const next = new URLSearchParams(params.toString())
    for (const key of [keys].flat()) {
      if (value && value !== ALL) next.set(key, value)
      else next.delete(key)
    }
    if (keys !== 'before') next.delete('before')
    router.push(`${pathname}?${next}`, { scroll: false })
  }

  const definitionName = (id: string | null) =>
    overview?.definitions.find((definition) => definition.id === id)?.name
  const sourceName = (id: string) => overview?.sources.find((source) => source.id === id)?.name

  const selects: {
    key: keyof AutomationHistoryFilter
    label: string
    options: [string, string][]
  }[] = [
    {
      key: 'definitionId',
      label: 'Workflow',
      options: (overview?.definitions ?? []).map((definition) => [definition.id, definition.name]),
    },
    {
      key: 'family',
      label: 'Event',
      options: automationFamilySchema.options.map((family) => [family, FAMILY_NAMES[family]]),
    },
    {
      key: 'sourceAppId',
      label: 'Repository',
      options: (overview?.sources ?? []).map((source) => [source.id, source.name]),
    },
    {
      key: 'status',
      label: 'Status',
      options: automationRunStatusSchema.options.map((status) => [status, runStatusLabel(status)]),
    },
    {
      key: 'mode',
      label: 'Handled by',
      options: [
        ['automation', 'Workflows'],
        ['legacy', 'Legacy intake'],
      ],
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <form
        aria-label="Run filters"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => event.preventDefault()}
      >
        {selects.map(({ key, label, options }) => (
          <Label className="grid gap-1 text-xs text-neutral-400" key={key}>
            {label}
            <Select onValueChange={(value) => setFilter(key, value)} value={filter[key] ?? ALL}>
              <SelectTrigger aria-label={`Filter by ${label.toLowerCase()}`} className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="start"
                className="max-w-[min(24rem,calc(100vw-2rem))]"
              >
                <SelectItem value={ALL}>All</SelectItem>
                {options.map(([value, text]) => (
                  <SelectItem className="break-words whitespace-normal" key={value} value={value}>
                    {text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
        ))}
        {(['since', 'until'] as const).map((key) => (
          <Label className="grid gap-1 text-xs text-neutral-400" key={key}>
            {key === 'since' ? 'From' : 'To (inclusive)'}
            <DatePicker
              aria-label={key === 'since' ? 'Runs from date' : 'Runs through date'}
              className="h-9 w-40"
              onChange={(day) => setFilter(key, runDateBoundary(day, key === 'until'))}
              min={key === 'until' ? runDateDay(filter.since) : undefined}
              max={key === 'since' ? runDateDay(filter.until, true) : undefined}
              placeholder="Any day"
              value={runDateDay(filter[key], key === 'until')}
            />
          </Label>
        ))}
        {filter.since || filter.until ? (
          <Button
            onClick={() => setFilter(['since', 'until'], '')}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear dates
          </Button>
        ) : null}
        {filter.versionId ? (
          <Button
            onClick={() => setFilter('versionId', '')}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear version filter
          </Button>
        ) : null}
        <p className="w-full text-xs text-neutral-500">
          Dates and times use your local timezone. To includes the entire selected day.
        </p>
        {params.size ? (
          <Button size="sm" variant="ghost" onClick={() => router.push(pathname)}>
            Clear filters
          </Button>
        ) : null}
      </form>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {items === null ? (
        <p className="text-sm text-neutral-500" role="status">
          Loading runs…
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl p-10 text-center text-sm text-neutral-500 ring-1 ring-white/[0.08]">
          No runs match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-white/[0.08]">
          <Table aria-label="Workflow runs" className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Outputs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.run.id}>
                  <TableCell className="max-w-80 whitespace-normal">
                    <Link
                      className="font-medium hover:underline"
                      href={`/workflows/runs/${item.run.id}?${new URLSearchParams({ returnTo: `${pathname}?${params}` })}`}
                    >
                      {item.event.snapshot.title}
                    </Link>
                    <p className="text-xs text-neutral-500">
                      {FAMILY_NAMES[item.event.snapshot.family]} · {triggeringObject(item)} ·{' '}
                      {item.event.snapshot.repositoryName || sourceName(item.event.sourceAppId)}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {definitionName(item.run.definitionId) ?? (
                      <span className="text-neutral-500">{runHandler(item)}</span>
                    )}
                    {item.run.versionRevision ? (
                      <p className="text-xs text-neutral-500">
                        Revision {item.run.versionRevision}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    <RunStatusPill status={item.run.status} />
                    {item.run.failureCode ||
                    (!runActive(item.run.status) && item.run.status !== 'succeeded') ? (
                      <p className="mt-1 text-xs text-neutral-500">
                        {FAILURE_CODES[item.run.failureCode] ?? item.run.reason}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-neutral-400">
                    {new Date(item.run.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-neutral-400">
                    {duration(item.run.createdAt, item.run.completedAt)}
                  </TableCell>
                  <TableCell className="text-xs text-neutral-400">
                    {[
                      item.run.outputs.releaseId ? 'Release' : '',
                      item.run.outputs.campaignId ? 'Campaign' : '',
                      item.run.outputs.postIds?.length
                        ? `${item.run.outputs.postIds.length} posts`
                        : '',
                      item.run.outputs.creditsCharged
                        ? `${item.run.outputs.creditsCharged} credits`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <nav aria-label="Run pages" className="flex justify-end gap-2">
        {before ? (
          <Button onClick={() => setFilter('before', '')} size="sm" variant="outline">
            Newest runs
          </Button>
        ) : null}
        {items?.length === 50 ? (
          <Button
            onClick={() => setFilter('before', items[items.length - 1]?.run.id ?? '')}
            size="sm"
            variant="outline"
          >
            Older runs
          </Button>
        ) : null}
      </nav>
    </div>
  )
}
