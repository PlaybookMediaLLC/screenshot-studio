'use client'

import { Search01Icon, WorkflowSquare03Icon } from 'hugeicons-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { EmptyState, Group, Pill, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getErrorMessage } from '@/components/workspace/settings-client'
import {
  automationFamilySchema,
  type AutomationDefinition,
} from '@/lib/api/contracts/release-automation'
import { useTRPC, useTRPCClient } from '@/lib/trpc/react'
import { FAMILY_NAMES } from './workflow-canvas'
import { RunStatusPill, relativeTime, triggeringObject } from './workflow-ui'
import { WorkflowArchiveButton } from './WorkflowArchiveButton'
import { runHandler } from '@/lib/workflows/history'
import { WorkflowRunLink } from './WorkflowRunLink'
import { WorkflowSources } from './WorkflowSources'

const PAGE_SIZE = 10
const STATES = {
  all: 'All workflows',
  active: 'Active',
  inactive: 'Inactive',
  disabled: 'Previously activated',
  archived: 'Archived',
  draft: 'Never activated',
}
const SORTS = { priority: 'Priority', name: 'Name', lastRun: 'Last run', updated: 'Last edited' }

function stateOf(definition: AutomationDefinition): keyof typeof STATES {
  if (definition.archived) return 'archived'
  if (definition.enabled) return 'active'
  return definition.activeVersionId ? 'disabled' : 'draft'
}

function Stat({ href, label, value }: { href?: string; label: string; value: number }) {
  const body = (
    <>
      <span className="text-2xl font-medium tabular-nums text-white">{value}</span>
      <span className="text-xs text-neutral-500">{label}</span>
    </>
  )
  const className =
    'flex flex-col gap-1 rounded-xl bg-white/[0.015] p-4 ring-1 ring-white/[0.08] transition-colors'
  return href ? (
    <Link className={`${className} hover:bg-white/[0.04]`} href={href}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

/** Every workflow in the workspace, what is running, and what needs a person. */
export function WorkflowsDashboard({ canManage }: { canManage: boolean }) {
  const client = useTRPCClient()
  const params = useSearchParams()
  const pathname = usePathname()
  const trpc = useTRPC()
  const overviewQuery = useQuery(
    trpc.releaseAutomation.overview.queryOptions(undefined, {
      staleTime: 15_000,
      refetchInterval: 15_000,
    })
  )
  const recentQuery = useQuery(
    trpc.releaseAutomation.recentRuns.queryOptions(undefined, {
      staleTime: 15_000,
      refetchInterval: 15_000,
    })
  )
  const overview = overviewQuery.data
  const recent = recentQuery.data?.items ?? []
  const [actionError, setError] = useState<string | null>(null)
  const queryError = overviewQuery.error ?? recentQuery.error
  const error = actionError ?? (queryError ? getErrorMessage(queryError) : null)
  const { refetch: refreshOverview } = overviewQuery
  const { refetch: refreshRecent } = recentQuery
  const [busy, setBusy] = useState(false)
  const query = params.get('q') ?? ''
  const state = (
    params.get('state') && params.get('state')! in STATES ? params.get('state') : 'all'
  ) as keyof typeof STATES
  const family = params.get('family') ?? 'all'
  const sort = (
    params.get('sort') && params.get('sort')! in SORTS ? params.get('sort') : 'priority'
  ) as keyof typeof SORTS
  const page = Math.max(0, Number.parseInt(params.get('page') ?? '0', 10) || 0)
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    window.history.replaceState(null, '', `${pathname}?${next}`)
  }
  const setQuery = (value: string) => setFilter('q', value)
  const setState = (value: string) => setFilter('state', value)
  const setFamily = (value: string) => setFilter('family', value)
  const setSort = (value: string) => setFilter('sort', value)
  const setPage = (value: number) => setFilter('page', String(value))
  const clearFilters = () => window.history.replaceState(null, '', pathname)

  const load = useCallback(async () => {
    await Promise.all([refreshOverview(), refreshRecent()])
  }, [refreshOverview, refreshRecent])

  const perform = useCallback(
    (action: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      void action()
        .then(load)
        .catch((failure) => setError(getErrorMessage(failure)))
        .finally(() => setBusy(false))
    },
    [load]
  )

  const sources = useMemo(
    () => new Map(overview?.sources.map((source) => [source.id, source]) ?? []),
    [overview]
  )
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase().replace(/\s+/g, ' ')
    const rows = (overview?.definitions ?? []).filter(
      (definition) =>
        (state === 'all'
          ? !definition.archived
          : state === 'inactive'
            ? !definition.enabled && !definition.archived
            : stateOf(definition) === state) &&
        (family === 'all' || definition.draft.family === family) &&
        (!search ||
          `${definition.name} ${definition.description} ${FAMILY_NAMES[definition.draft.family]} ${sources.get(definition.sourceAppId)?.name ?? ''}`
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .includes(search))
    )
    const key = (definition: AutomationDefinition) =>
      sort === 'name'
        ? definition.name.toLowerCase()
        : sort === 'lastRun'
          ? -(definition.lastRun ? new Date(definition.lastRun.createdAt).getTime() : 0)
          : sort === 'updated'
            ? -new Date(definition.updatedAt).getTime()
            : definition.enabled
              ? definition.activePriority
              : 10_000 + definition.priority
    return rows.sort((a, b) =>
      key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id.localeCompare(b.id)
    )
  }, [overview, query, state, family, sort, sources])

  if (!overview) {
    return error ? (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <p className="text-sm text-neutral-500" role="status">
        Loading workflows…
      </p>
    )
  }

  const counts = overview.runCounts ?? {}
  const current = overview.definitions.filter((definition) => !definition.archived)
  const legacyTotal = Object.values(overview.legacyRunCounts ?? {}).reduce(
    (sum, value) => sum + value,
    0
  )
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages - 1)
  const shown = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const definitionName = (id: string | null) =>
    overview.definitions.find((definition) => definition.id === id)?.name
  const campaigns = recent.filter((item) => item.run.outputs.campaignId).slice(0, 5)

  return (
    <div className="flex flex-col gap-10">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!overview.executorAvailable ? (
        <Alert>
          <AlertDescription>
            No workflow worker is running. Drafts and tests still work; activation and new runs wait
            for a worker.
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        aria-label="Workflow summary"
        className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5"
      >
        <Stat href="/workflows#definitions" label="Workflows" value={current.length} />
        <Stat
          href="/workflows?state=active#definitions"
          label="Active"
          value={current.filter((definition) => definition.enabled).length}
        />
        <Stat
          href="/workflows?state=inactive#definitions"
          label="Inactive"
          value={current.filter((definition) => !definition.enabled).length}
        />
        <Stat
          href="/workflows/runs?mode=automation&status=running"
          label="Running now"
          value={counts.running ?? 0}
        />
        <Stat
          href="/workflows/runs?mode=automation&status=succeeded"
          label="Succeeded"
          value={counts.succeeded ?? 0}
        />
        <Stat
          href="/workflows/runs?mode=automation&status=failed"
          label="Failed"
          value={counts.failed ?? 0}
        />
        <Stat
          href="/workflows/runs?mode=automation&status=needs_attention"
          label="Need attention"
          value={counts.needs_attention ?? 0}
        />
        <Stat
          href="/workflows/runs?mode=automation&status=queued"
          label="Queued"
          value={counts.queued ?? 0}
        />
        <Stat
          href="/workflows/runs?mode=automation&status=skipped"
          label="Skipped"
          value={counts.skipped ?? 0}
        />
        <Stat
          href="/workflows#sources"
          label="Connected sources"
          value={overview.sources.filter((source) => source.connectionState === 'connected').length}
        />
      </section>

      <p className="-mt-6 text-xs text-neutral-500">
        Run totals cover automation events.{' '}
        <Link className="underline" href="/workflows/runs?mode=legacy">
          Legacy intake: {legacyTotal} events
        </Link>
        , counted separately.
      </p>
      <div id="definitions" />
      <Section
        actions={
          canManage ? (
            <ButtonLink href="/workflows/new" size="sm">
              New workflow
            </ButtonLink>
          ) : null
        }
        description="Each workflow runs one GitHub event family for one repository. Lower priority wins; the first match runs."
        title="Definitions"
      >
        {overview.definitions.length === 0 ? (
          <EmptyState
            action={
              canManage ? (
                <ButtonLink href="/workflows/new">Start from a template</ButtonLink>
              ) : null
            }
            description="Turn a published release, a merged pull request, or a production deployment into campaign drafts for review."
            icon={WorkflowSquare03Icon}
            title="No workflows yet"
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Label className="relative block w-full md:max-w-64">
                <span className="sr-only">Search workflows</span>
                <Search01Icon
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-500"
                  size={15}
                />
                <Input
                  className="h-9 w-full rounded-lg bg-white/[0.03] pr-3 pl-9 text-sm"
                  onChange={(event) => {
                    setQuery(event.target.value)
                  }}
                  placeholder="Search"
                  type="search"
                  value={query}
                />
              </Label>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
              {(
                [
                  ['Filter by state', state, setState, STATES],
                  [
                    'Filter by event',
                    family,
                    setFamily,
                    {
                      all: 'All events',
                      ...Object.fromEntries(
                        automationFamilySchema.options.map((option) => [
                          option,
                          FAMILY_NAMES[option],
                        ])
                      ),
                    },
                  ],
                  ['Sort by', sort, setSort, SORTS],
                ] as const
              ).map(([label, value, set, options]) => (
                <Select
                  key={label}
                  onValueChange={(next) => {
                    ;(set as (value: string) => void)(next)
                  }}
                  value={value}
                >
                  <SelectTrigger aria-label={label} className="h-9 w-full md:w-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(options).map(([key, text]) => (
                      <SelectItem key={key} value={key}>
                        {label === 'Sort by' ? `Sort: ${text}` : text}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
            </div>
            <Group>
              {shown.length === 0 ? (
                <Row>
                  <p className="text-sm text-neutral-500">No workflows match these filters.</p>
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </Row>
              ) : (
                shown.map((definition) => {
                  const source = sources.get(definition.sourceAppId)
                  const definitionState = stateOf(definition)
                  const order = current
                    .filter(
                      (candidate) =>
                        candidate.sourceAppId === definition.sourceAppId &&
                        candidate.draft.family === definition.draft.family &&
                        candidate.enabled
                    )
                    .sort((a, b) => a.activePriority - b.activePriority || a.id.localeCompare(b.id))
                  const ties = current.filter(
                    (candidate) =>
                      candidate.id !== definition.id &&
                      candidate.sourceAppId === definition.sourceAppId &&
                      candidate.draft.family === definition.draft.family &&
                      (candidate.enabled ? candidate.activePriority : candidate.priority) ===
                        (definition.enabled ? definition.activePriority : definition.priority)
                  )
                  return (
                    <Row
                      description={
                        <>
                          {definition.description ? (
                            <span className="block">{definition.description}</span>
                          ) : null}
                          <span>
                            {FAMILY_NAMES[definition.draft.family]} ·{' '}
                            {source?.name ?? 'Repository removed'} ·{' '}
                            {definition.enabled
                              ? `active priority ${definition.activePriority}`
                              : `priority ${definition.priority}`}{' '}
                            · draft revision {definition.revision} · {definition.recentRuns ?? 0}{' '}
                            runs in 30 days
                          </span>
                          <span className="block">
                            Last edited{' '}
                            <time
                              dateTime={definition.updatedAt}
                              title={new Date(definition.updatedAt).toLocaleString()}
                            >
                              {relativeTime(definition.updatedAt)}
                            </time>
                          </span>
                          {definition.issues.map((issue, index) => (
                            <Link
                              key={index}
                              className="block text-amber-300 underline"
                              href={`/workflows/${definition.id}?node=${encodeURIComponent(issue.nodeId)}`}
                            >
                              {issue.message} · Fix in editor
                            </Link>
                          ))}
                          {ties.length ? (
                            <span className="block text-amber-300">
                              Priority tie with {ties.map((item) => item.name).join(', ')}. Active
                              ties run by definition ID; inactive drafts do not compete.
                            </span>
                          ) : null}
                          {definition.enabled && order.length > 1 ? (
                            <span className="block">
                              Run order {order.findIndex((item) => item.id === definition.id) + 1}{' '}
                              of {order.length}. {order[0]?.name} is checked first; the first match
                              wins.
                            </span>
                          ) : null}
                        </>
                      }
                      key={definition.id}
                      label={
                        <span className="flex flex-wrap items-center gap-2">
                          <Link className="hover:underline" href={`/workflows/${definition.id}`}>
                            {definition.name}
                          </Link>
                          <Pill tone={definitionState === 'active' ? 'green' : 'gray'}>
                            {STATES[definitionState]}
                          </Pill>
                          {definition.issues.length ? (
                            <Pill tone="yellow">
                              {definition.issues.length} validation{' '}
                              {definition.issues.length === 1 ? 'issue' : 'issues'}
                            </Pill>
                          ) : null}
                        </span>
                      }
                    >
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {definition.lastRun ? (
                          <WorkflowRunLink
                            className="flex items-center gap-2 text-xs text-neutral-500 hover:text-neutral-200"
                            href={`/workflows/runs/${definition.lastRun.id}`}
                          >
                            <RunStatusPill status={definition.lastRun.status} />
                            {relativeTime(definition.lastRun.createdAt)}
                          </WorkflowRunLink>
                        ) : (
                          <span className="text-xs text-neutral-600">No runs yet</span>
                        )}
                        <ButtonLink
                          href={`/workflows/${definition.id}`}
                          size="sm"
                          variant="outline"
                        >
                          {canManage ? 'Edit' : 'Inspect'}
                          <span className="sr-only"> {definition.name}</span>
                        </ButtonLink>
                        {canManage ? (
                          <>
                            <ButtonLink
                              href={`/workflows/${definition.id}?copy=1`}
                              size="sm"
                              variant="ghost"
                            >
                              Duplicate<span className="sr-only"> {definition.name}</span>
                            </ButtonLink>
                            <WorkflowArchiveButton
                              definition={definition}
                              disabled={busy}
                              onChanged={() => void load()}
                            />
                            {definition.enabled ? (
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  perform(() =>
                                    client.releaseAutomation.disable.mutate({
                                      id: definition.id,
                                      revision: definition.revision,
                                    })
                                  )
                                }
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                Deactivate<span className="sr-only"> {definition.name}</span>
                              </Button>
                            ) : !definition.archived ? (
                              <Button
                                disabled={
                                  busy ||
                                  definition.issues.length > 0 ||
                                  !overview.executorAvailable
                                }
                                onClick={() =>
                                  perform(() =>
                                    client.releaseAutomation.activate.mutate({
                                      id: definition.id,
                                      revision: definition.revision,
                                    })
                                  )
                                }
                                size="sm"
                                title={
                                  definition.issues.length
                                    ? 'Fix validation issues in the editor first.'
                                    : undefined
                                }
                                type="button"
                                variant="ghost"
                              >
                                Activate<span className="sr-only"> {definition.name}</span>
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </Row>
                  )
                })
              )}
            </Group>
            {pages > 1 ? (
              <nav
                aria-label="Workflow pages"
                className="flex items-center justify-end gap-2 text-sm"
              >
                <Button
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                  size="sm"
                  variant="outline"
                >
                  Previous
                </Button>
                <span className="text-neutral-500">
                  Page {currentPage + 1} of {pages}
                </span>
                <Button
                  disabled={currentPage + 1 >= pages}
                  onClick={() => setPage(currentPage + 1)}
                  size="sm"
                  variant="outline"
                >
                  Next
                </Button>
              </nav>
            ) : null}
          </>
        )}
      </Section>

      <div className="grid gap-10 xl:grid-cols-2">
        <Section
          actions={
            <ButtonLink href="/workflows/runs" size="sm" variant="ghost">
              All runs
            </ButtonLink>
          }
          description="The latest accepted events and what happened to them."
          title="Recent runs"
        >
          <Group>
            {recent.length === 0 ? (
              <Row>
                <p className="text-sm text-neutral-500">No events recorded yet.</p>
              </Row>
            ) : (
              recent.slice(0, 6).map((item) => (
                <Row
                  description={`${definitionName(item.run.definitionId) ?? runHandler(item)} · ${triggeringObject(item)} · ${relativeTime(item.event.receivedAt)}`}
                  key={item.run.id}
                  label={
                    <WorkflowRunLink
                      className="hover:underline"
                      href={`/workflows/runs/${item.run.id}`}
                    >
                      {item.event.snapshot.title}
                    </WorkflowRunLink>
                  }
                  layout="inline"
                >
                  <RunStatusPill status={item.run.status} />
                </Row>
              ))
            )}
          </Group>
        </Section>
        <Section
          description="Campaign drafts that workflows created. Review state lives on the campaign."
          title="Campaigns from workflows"
        >
          <Group>
            {campaigns.length === 0 ? (
              <Row>
                <p className="text-sm text-neutral-500">No workflow has created a campaign yet.</p>
              </Row>
            ) : (
              campaigns.map((item) => (
                <Row
                  description={`${definitionName(item.run.definitionId) ?? 'Workflow'} · ${relativeTime(item.run.createdAt)}`}
                  key={item.run.id}
                  label={item.event.snapshot.title}
                  layout="inline"
                >
                  <ButtonLink
                    href={`/campaigns/${item.run.outputs.campaignId}/copy`}
                    size="sm"
                    variant="outline"
                  >
                    Open campaign<span className="sr-only"> {item.event.snapshot.title}</span>
                  </ButtonLink>
                </Row>
              ))
            )}
          </Group>
        </Section>
      </div>

      <Section
        description="Repositories and installations that can trigger workflows. GitHub is the event source today."
        title="Event sources"
      >
        <WorkflowSources busy={busy} canManage={canManage} overview={overview} perform={perform} />
      </Section>
    </div>
  )
}
